// Captura do som do sistema com exclusão de processos.
//
// O loopback padrão do Electron mistura todo o áudio do computador — inclusive
// a voz que o próprio Freehub está tocando, que voltaria para a sala. Aqui a
// captura é feita pelo helper nativo (WASAPI process loopback), que consegue
// deixar uma árvore de processos de fora.
//
// Com uma lista de apps silenciados vazia, um único helper roda em modo
// EXCLUDE contra a árvore do Freehub. Com qualquer app silenciado, o conjunto
// é montado pelo outro lado: um helper INCLUDE por app audível, misturados
// neste processo. O modo INCLUDE também permite descobrir apps que começam a
// tocar depois do início da transmissão, com uma varredura periódica.

import { app, ipcMain, type WebContents } from 'electron';
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  getSystemAudioSettings,
  saveSystemAudioSettings,
  type SystemAudioSettings,
} from './audioSettings';
import { IPC } from '../shared/ipc';

const HELPER_NAME = 'freehub-capture.exe';
const READY_LINE = 'READY';
const READY_TIMEOUT_MS = 6000;
const EXIT_UNSUPPORTED = 3;

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_FRAME = CHANNELS * BYTES_PER_SAMPLE;
const CHUNK_MS = 20;
const CHUNK_BYTES = (SAMPLE_RATE / 1000) * CHUNK_MS * BYTES_PER_FRAME;

// Uma fonte sem pacotes por este tempo é tratada como silêncio, não como
// travamento: o process loopback simplesmente não entrega nada quando o app
// não está tocando.
const SOURCE_IDLE_MS = 120;
// Meio segundo de áudio acumulado. Se ninguém consome, o mais antigo sai.
const SOURCE_MAX_QUEUED_BYTES = (SAMPLE_RATE * BYTES_PER_FRAME) / 2;
// Reavalia quais apps estão tocando. Também é o que detecta um app aberto
// depois do início do compartilhamento.
const RESCAN_MS = 4000;

// O Explorer inicia quase tudo que o usuário abre. Incluir sua árvore em um
// helper INCLUDE traria de volta justamente o que deveria ficar de fora.
const NEVER_INCLUDE_AS_TREE = new Set(['explorer.exe']);

let knownUnsupported = false;
let ipcRegistered = false;

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, HELPER_NAME)
    : path.join(app.getAppPath(), 'native', 'bin', HELPER_NAME);
}

export function isSystemAudioExclusionSupported(): boolean {
  if (process.platform !== 'win32' || knownUnsupported) return false;
  return existsSync(helperPath());
}

export interface AudioApp {
  key: string;
  name: string;
  path: string;
  pids: number[];
  self: boolean;
}

function cleanName(key: string, raw: string, exePath: string): string {
  const fallback = path.basename(exePath);
  if (key === 'explorer.exe') return 'Gerenciador de arquivos';
  if (key === 'whatsapp.root.exe' || key === 'whatsapp.exe') return 'WhatsApp';
  return raw.trim() || fallback;
}

function parseListing(stdout: string): AudioApp[] {
  const ownPath = path.resolve(process.execPath).toLowerCase();
  const byKey = new Map<string, AudioApp>();
  for (const line of stdout.split('\n')) {
    const parts = line.replace(/\r$/, '').split('\t');
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const rawName = parts[1];
    const exePath = parts.slice(2).join('\t').trim();
    if (!Number.isInteger(pid) || pid <= 0 || exePath.length === 0) continue;

    const key = path.basename(exePath).toLowerCase();
    if (key === HELPER_NAME) continue;

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.pids.includes(pid)) existing.pids.push(pid);
      continue;
    }

    byKey.set(key, {
      key,
      name: cleanName(key, rawName, exePath),
      path: exePath,
      pids: [pid],
      // Em desenvolvimento o executável é o electron.exe; comparar caminhos
      // evita tomar outro app Electron como se fosse o Freehub.
      self: path.resolve(exePath).toLowerCase() === ownPath,
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function runListing(mode: string): Promise<AudioApp[]> {
  if (!isSystemAudioExclusionSupported()) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      helperPath(),
      [mode],
      { timeout: 4000, maxBuffer: 2 << 20, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error && typeof code === 'string') knownUnsupported = true;
        if (typeof stdout !== 'string' || (error && stdout.length === 0)) {
          resolve([]);
          return;
        }
        resolve(parseListing(stdout));
      },
    );
  });
}

/** Apps com uma sessão de áudio ativa — o que a captura deve considerar. */
export function listAudioApps(): Promise<AudioApp[]> {
  return runListing('--list-sessions');
}

/** Apps com janela aberta — o que o painel do seletor mostra. */
export function listOpenApps(): Promise<AudioApp[]> {
  return runListing('--list-windows');
}

// ---------------------------------------------------------------------------
// Captura e mistura
// ---------------------------------------------------------------------------

interface CaptureSource {
  pid: number;
  child: ChildProcessWithoutNullStreams;
  queue: Buffer[];
  queued: number;
  lastDataAt: number;
}

interface Capture {
  target: WebContents;
  detachTarget: () => void;
  mode: 'exclude' | 'include';
  muted: string[];
  sources: Map<number, CaptureSource>;
  rescan: NodeJS.Timeout | null;
  stopping: boolean;
}

let capture: Capture | null = null;
// Guardado para permitir que o seletor ligue o som depois de a captura ter
// sido desligada por ele mesmo, durante o mesmo getDisplayMedia.
let lastTarget: WebContents | null = null;

export function isSystemAudioCapturing(): boolean {
  return capture !== null;
}

export interface SystemAudioState {
  supported: boolean;
  active: boolean;
  enabled: boolean;
}

export function getSystemAudioState(): SystemAudioState {
  return {
    supported: isSystemAudioExclusionSupported(),
    active: capture !== null,
    enabled: getSystemAudioSettings().enabled,
  };
}

export async function startSystemAudioCapture(
  webContents: WebContents,
  options?: { enabled?: boolean },
): Promise<boolean> {
  if (!isSystemAudioExclusionSupported() || webContents.isDestroyed()) {
    return false;
  }

  if (typeof options?.enabled === 'boolean') {
    saveSystemAudioSettings({ enabled: options.enabled });
  }

  stopSystemAudioCapture(false);
  lastTarget = webContents;

  const settings = getSystemAudioSettings();
  const muted = new Set(settings.mutedApps);
  const perApp = muted.size > 0;
  const apps = perApp ? await listAudioApps() : [];

  if (!isSystemAudioExclusionSupported()) return false;
  // Outro compartilhamento pode ter começado durante a listagem.
  if (capture !== null) return false;

  const active: Capture = {
    target: webContents,
    detachTarget: () => undefined,
    mode: perApp ? 'include' : 'exclude',
    muted: [...muted],
    sources: new Map(),
    rescan: null,
    stopping: false,
  };
  capture = active;
  active.detachTarget = watchTarget(active, webContents);

  let settle!: (ready: boolean) => void;
  let settled = false;
  const ready = new Promise<boolean>((resolve) => {
    settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!value && capture === active) stopSystemAudioCapture(false);
      resolve(value);
    };
    const timer = setTimeout(() => settle(false), READY_TIMEOUT_MS);
    timer.unref?.();
  });

  if (active.mode === 'exclude') {
    addSource(active, 0, ['--exclude-pid', String(process.pid)], settle);
  } else {
    const wanted = includablePids(apps, muted);
    for (const pid of wanted) {
      addSource(active, pid, ['--include-pid', String(pid)], settle);
    }
    // Silêncio é um resultado válido (todos os apps com som silenciados).
    // A varredura abaixo encontra qualquer app que comece a tocar.
    if (wanted.length === 0) settle(true);
    active.rescan = setInterval(() => void rescanSources(active), RESCAN_MS);
    active.rescan.unref?.();
  }

  return ready;
}

function includablePids(apps: AudioApp[], muted: Set<string>): number[] {
  const pids: number[] = [];
  for (const entry of apps) {
    if (entry.self || muted.has(entry.key)) continue;
    if (NEVER_INCLUDE_AS_TREE.has(entry.key)) continue;
    pids.push(...entry.pids);
  }
  return pids;
}

function addSource(
  active: Capture,
  pid: number,
  args: string[],
  onReady?: (ready: boolean) => void,
): void {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(helperPath(), [...args, '--parent-pid', String(process.pid)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    onReady?.(false);
    return;
  }

  const source: CaptureSource = {
    pid,
    child,
    queue: [],
    queued: 0,
    lastDataAt: Date.now(),
  };
  active.sources.set(pid, source);

  child.stdout.on('data', (data: Buffer) => {
    if (active.stopping) return;
    source.lastDataAt = Date.now();
    source.queue.push(data);
    source.queued += data.length;
    while (
      source.queued > SOURCE_MAX_QUEUED_BYTES &&
      source.queue.length > 1
    ) {
      source.queued -= source.queue.shift()!.length;
    }
    drain(active);
  });

  child.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes(READY_LINE)) {
      onReady?.(true);
      return;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) console.error(`[audiocap] ${trimmed}`);
    }
  });

  const finish = (code?: number | null): void => {
    if (code === EXIT_UNSUPPORTED) knownUnsupported = true;
    if (active.stopping || capture !== active) return;
    if (active.sources.get(pid) !== source) return;
    active.sources.delete(pid);

    // Em modo INCLUDE, um helper terminando é rotina: o app fechou. A
    // captura continua e a varredura o reconecta se ele voltar.
    if (active.mode === 'include' && code !== EXIT_UNSUPPORTED) {
      onReady?.(true);
      return;
    }

    onReady?.(false);
    endCapture(active);
  };

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (typeof err.code === 'string') knownUnsupported = true;
    finish(EXIT_UNSUPPORTED);
  });
  child.on('exit', (code) => finish(code));
}

async function rescanSources(active: Capture): Promise<void> {
  if (capture !== active || active.stopping) return;
  const apps = await listAudioApps();
  if (capture !== active || active.stopping) return;
  // Lista vazia pode ser "nada tocando" ou uma falha passageira. Não
  // desmontar tudo é a leitura segura.
  if (apps.length === 0) return;

  const wanted = new Set(includablePids(apps, new Set(active.muted)));
  for (const pid of wanted) {
    if (!active.sources.has(pid)) {
      addSource(active, pid, ['--include-pid', String(pid)]);
    }
  }
  for (const [pid, source] of active.sources) {
    if (wanted.has(pid)) continue;
    active.sources.delete(pid);
    endHelper(source.child);
  }
}

function drain(active: Capture): void {
  if (capture !== active || active.stopping) return;
  for (;;) {
    const now = Date.now();
    const contributors: CaptureSource[] = [];
    for (const source of active.sources.values()) {
      if (source.queued >= CHUNK_BYTES) {
        contributors.push(source);
      } else if (now - source.lastDataAt < SOURCE_IDLE_MS) {
        // Ainda entregando, só não tem um bloco inteiro. Esperar mantém o
        // alinhamento entre as fontes.
        return;
      }
    }
    if (contributors.length === 0) return;

    const chunks = contributors.map((source) => take(source, CHUNK_BYTES));
    const mixed = chunks.length === 1 ? chunks[0] : mix(chunks);
    if (active.target.isDestroyed()) {
      stopSystemAudioCapture(false);
      return;
    }
    active.target.send(IPC.systemAudioData, mixed);
  }
}

function take(source: CaptureSource, bytes: number): Buffer {
  const joined =
    source.queue.length === 1
      ? source.queue[0]
      : Buffer.concat(source.queue, source.queued);
  const head = joined.subarray(0, bytes);
  const rest = joined.subarray(bytes);
  source.queue = rest.length > 0 ? [rest] : [];
  source.queued = rest.length;
  return head;
}

function mix(chunks: Buffer[]): Buffer {
  const output = Buffer.allocUnsafe(CHUNK_BYTES);
  for (let offset = 0; offset < CHUNK_BYTES; offset += 2) {
    let sum = 0;
    for (const chunk of chunks) sum += chunk.readInt16LE(offset);
    const clamped = sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum;
    output.writeInt16LE(clamped, offset);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Ciclo de vida e configurações
// ---------------------------------------------------------------------------

/**
 * Reaplica as escolhas do seletor a uma captura em andamento. Trocar a lista
 * de apps silenciados reinicia os helpers; a trilha de áudio do renderer
 * continua a mesma e só vê um pequeno intervalo de silêncio.
 */
export async function applySystemAudioSettings(
  settings: SystemAudioSettings,
): Promise<void> {
  const active = capture;
  if (!active) {
    if (
      settings.enabled &&
      lastTarget &&
      !lastTarget.isDestroyed() &&
      isSystemAudioExclusionSupported()
    ) {
      await startSystemAudioCapture(lastTarget);
    }
    return;
  }

  if (!settings.enabled) {
    stopSystemAudioCapture(false);
    return;
  }

  const next = [...settings.mutedApps].sort().join('\0');
  const current = [...active.muted].sort().join('\0');
  if (next === current) return;

  const target = active.target;
  stopSystemAudioCapture(false);
  if (!target.isDestroyed()) await startSystemAudioCapture(target);
}

function endCapture(active: Capture): void {
  const target = active.target;
  stopSystemAudioCapture(false);
  if (!target.isDestroyed()) target.send(IPC.systemAudioEnded);
}

function endHelper(child: ChildProcessWithoutNullStreams): void {
  try {
    child.stdin.end();
  } catch {
    // Já fechado; o handler de exit cobre.
  }
  const force = setTimeout(() => {
    if (!child.killed) child.kill();
  }, 1000);
  force.unref?.();
  child.once('exit', () => clearTimeout(force));
}

/** Para a captura. `clearTarget=false` mantém o alvo para reconfigurações. */
export function stopSystemAudioCapture(clearTarget = true): void {
  if (clearTarget) lastTarget = null;
  const active = capture;
  if (!active) return;
  active.stopping = true;
  capture = null;
  if (active.rescan) clearInterval(active.rescan);
  active.detachTarget();
  for (const source of active.sources.values()) endHelper(source.child);
  active.sources.clear();
}

function watchTarget(active: Capture, webContents: WebContents): () => void {
  const onGone = (): void => {
    if (capture === active) stopSystemAudioCapture(false);
  };
  const onNavigate = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ): void => {
    if (details.isMainFrame && !details.isSameDocument) onGone();
  };
  webContents.once('destroyed', onGone);
  webContents.on('render-process-gone', onGone);
  webContents.on('did-start-navigation', onNavigate);
  return () => {
    if (webContents.isDestroyed()) return;
    webContents.off('destroyed', onGone);
    webContents.off('render-process-gone', onGone);
    webContents.off('did-start-navigation', onNavigate);
  };
}

export function registerSystemAudioIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle(IPC.systemAudioStart, (event, options: unknown) => {
    const enabled =
      options &&
      typeof options === 'object' &&
      typeof (options as { enabled?: unknown }).enabled === 'boolean'
        ? (options as { enabled: boolean }).enabled
        : undefined;
    return startSystemAudioCapture(event.sender, { enabled });
  });

  ipcMain.on(IPC.systemAudioStop, () => stopSystemAudioCapture());

  ipcMain.handle(IPC.systemAudioState, () => getSystemAudioState());

  ipcMain.handle(IPC.systemAudioSetEnabled, (_event, enabled: unknown) => {
    const settings = saveSystemAudioSettings({ enabled: enabled === true });
    void applySystemAudioSettings(settings);
    return settings.enabled;
  });
}
