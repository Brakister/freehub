import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  type DesktopCapturerSource,
} from 'electron';
import { join } from 'node:path';
import { APP_NAME } from './constants';
import {
  getSystemAudioSettings,
  normalizeAppKeys,
  saveSystemAudioSettings,
} from './audioSettings';
import {
  applySystemAudioSettings,
  isSystemAudioExclusionSupported,
  listOpenApps,
} from './systemAudio';
import { getLastShareSourceId, saveLastShareSourceId } from './shareSettings';
import type {
  PickerAudioApp,
  PickerChoice,
  PickerData,
  PickerSource,
} from '../shared/picker';
import { IPC } from '../shared/ipc';

let currentSourcesById = new Map<string, DesktopCapturerSource>();
let currentData: PickerData | null = null;
let selectHandler:
  | ((picked: PickedDesktopSource | null) => void)
  | null = null;
let pickerWindow: BrowserWindow | null = null;
let handlersRegistered = false;
let activePick: Promise<PickedDesktopSource | null> | null = null;

export interface PickedDesktopSource {
  source: DesktopCapturerSource;
  choice: PickerChoice;
}

const iconCache = new Map<string, Promise<string | null>>();

function iconFor(filePath: string): Promise<string | null> {
  if (!filePath) return Promise.resolve(null);
  const cached = iconCache.get(filePath);
  if (cached) return cached;
  const promise = app
    .getFileIcon(filePath, { size: 'small' })
    .then((icon) => (icon.isEmpty() ? null : icon.toDataURL()))
    .catch(() => null);
  iconCache.set(filePath, promise);
  return promise;
}

function registerPickerIpc(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(IPC.pickerList, (): PickerData => {
    return (
      currentData ?? {
        sources: [],
        selectedId: null,
        audio: { supported: false, perApp: false, enabled: false },
      }
    );
  });

  ipcMain.handle(IPC.pickerAudioApps, async (): Promise<PickerAudioApp[]> => {
    const settings = getSystemAudioSettings();
    const muted = new Set(settings.mutedApps);
    const apps = await listOpenApps();

    let selfPresent = apps.some((entry) => entry.self);
    if (!selfPresent) {
      selfPresent = true;
      apps.push({
        key: process.execPath.split(/[\\/]/).pop()!.toLowerCase(),
        name: APP_NAME,
        path: process.execPath,
        pids: [],
        self: true,
      });
    }

    const rows = await Promise.all(
      apps.map(async (entry) => ({
        key: entry.key,
        name: entry.self ? APP_NAME : entry.name,
        icon: await iconFor(entry.path),
        muted: entry.self ? true : muted.has(entry.key),
        locked: entry.self,
      })),
    );

    rows.sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return rows;
  });

  ipcMain.on(IPC.pickerChoose, (_event, raw: unknown) => {
    const choice =
      raw && typeof raw === 'object' ? (raw as Partial<PickerChoice>) : null;
    if (!choice || choice.id === null || typeof choice.id !== 'string') {
      finishPick(null);
      return;
    }

    const source = currentSourcesById.get(choice.id);
    if (!source) {
      finishPick(null);
      return;
    }

    let audio: PickerChoice['audio'];
    if (choice.audio && typeof choice.audio === 'object') {
      audio = {
        enabled: choice.audio.enabled !== false,
        ...(Array.isArray(choice.audio.muted)
          ? { muted: normalizeAppKeys(choice.audio.muted) }
          : {}),
        ...(Array.isArray(choice.audio.listed)
          ? { listed: normalizeAppKeys(choice.audio.listed) }
          : {}),
      };
    }

    finishPick({ id: source.id, audio });
  });
}

function finishPick(choice: PickerChoice | null): void {
  const handler = selectHandler;
  selectHandler = null;
  const windowToClose = pickerWindow;
  pickerWindow = null;
  if (windowToClose && !windowToClose.isDestroyed()) windowToClose.destroy();

  const source = choice?.id ? currentSourcesById.get(choice.id) : undefined;

  if (choice && source) {
    saveLastShareSourceId(choice.id!);

    if (choice.audio) {
      const saved = getSystemAudioSettings();
      let mutedApps = saved.mutedApps;
      if (choice.audio.muted !== undefined) {
        const muted = new Set(choice.audio.muted);
        const listed = new Set(choice.audio.listed ?? []);
        mutedApps = saved.mutedApps.filter((key) => !listed.has(key));
        for (const key of muted) mutedApps.push(key);
      }
      const next = saveSystemAudioSettings({
        enabled: choice.audio.enabled,
        mutedApps,
      });
      const resolve = (): void => {
        handler?.(choice && source ? { source, choice } : null);
      };
      void applySystemAudioSettings(next).finally(resolve);
      return;
    }
  }

  handler?.(choice && source ? { source, choice } : null);
}

function serializeSources(sources: DesktopCapturerSource[]): PickerSource[] {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    appIcon:
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.toDataURL()
        : null,
  }));
}

async function openPicker(): Promise<PickedDesktopSource | null> {
  registerPickerIpc();

  let sources: DesktopCapturerSource[] = [];
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 360, height: 220 },
      fetchWindowIcons: true,
    });
  } catch (error) {
    console.error('[picker] falha ao listar fontes:', error);
    return null;
  }

  if (sources.length === 0) return null;

  currentSourcesById = new Map(sources.map((source) => [source.id, source]));

  const serialized = serializeSources(sources);
  serialized.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'screen' ? -1 : 1;
    return a.kind === 'screen' ? 0 : a.name.localeCompare(b.name, 'pt-BR');
  });

  const savedId = getLastShareSourceId();
  const selectedId =
    savedId && serialized.some((source) => source.id === savedId) ? savedId : null;
  const supported = isSystemAudioExclusionSupported();

  currentData = {
    sources: serialized,
    selectedId,
    audio: {
      supported,
      perApp: supported,
      enabled: getSystemAudioSettings().enabled,
    },
  };

  const window = new BrowserWindow({
    width: 900,
    height: 660,
    minWidth: 680,
    minHeight: 520,
    show: false,
    title: 'Compartilhar tela',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/picker.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  pickerWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  window.on('closed', () => {
    if (pickerWindow === window) pickerWindow = null;
    const handler = selectHandler;
    selectHandler = null;
    handler?.(null);
  });

  const result = new Promise<PickedDesktopSource | null>((resolve) => {
    selectHandler = resolve;
  });

  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(buildPickerHtml()),
    );
  } catch (error) {
    console.error('[picker] falha ao carregar a janela:', error);
    finishPick(null);
  }

  return result;
}

export function pickDesktopSource(): Promise<PickedDesktopSource | null> {
  if (activePick) {
    if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.focus();
    return activePick;
  }
  let promise: Promise<PickedDesktopSource | null>;
  promise = openPicker().finally(() => {
    if (activePick === promise) activePick = null;
  });
  activePick = promise;
  return promise;
}

export function buildPickerHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Compartilhar tela</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #1e1f22;
    --panel: #2b2d31;
    --panel-2: #313338;
    --border: #3a3d41;
    --text: #f2f3f5;
    --muted: #b5bac1;
    --accent: #5865f2;
    --accent-hover: #4752c4;
    --green: #23a559;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    user-select: none;
    position: relative;
    overflow: hidden;
  }
  [hidden] { display: none !important; }
  header { padding: 20px 24px 0; flex: none; }
  .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  p.sub { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
  .brand { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-top: 2px; }
  nav { display: flex; gap: 4px; margin-top: 18px; border-bottom: 1px solid var(--border); }
  nav button {
    appearance: none; border: 0; border-bottom: 2px solid transparent;
    background: transparent; color: var(--muted); cursor: pointer;
    font: inherit; font-weight: 600; padding: 9px 14px; margin-bottom: -1px;
  }
  nav button:hover { color: var(--text); }
  nav button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
  main {
    flex: 1; min-height: 0; overflow-y: auto; padding: 18px 24px 22px;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px; align-content: start;
  }
  main::-webkit-scrollbar, .apps::-webkit-scrollbar { width: 10px; }
  main::-webkit-scrollbar-thumb, .apps::-webkit-scrollbar-thumb { background: #1a1b1e; border-radius: 8px; border: 2px solid var(--bg); }
  .loading, .empty { grid-column: 1 / -1; color: var(--muted); text-align: center; padding: 70px 10px; }
  .card {
    appearance: none; font: inherit; color: inherit; text-align: left;
    background: var(--panel); border: 2px solid var(--border); border-radius: 10px;
    padding: 9px; cursor: pointer; min-width: 0;
    display: flex; flex-direction: column; gap: 9px; outline: none;
  }
  .card:hover { border-color: #50545b; background: var(--panel-2); }
  .card:focus-visible { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }
  .card[aria-selected="true"] { border-color: var(--accent); background: var(--panel-2); }
  .thumb {
    width: 100%; aspect-ratio: 16 / 10; object-fit: contain; display: block;
    background: #000; border-radius: 6px;
  }
  .thumb.placeholder {
    display: flex; align-items: center; justify-content: center;
    color: #6d7178; font-size: 26px; border: 1px dashed #3f434a;
  }
  .card-label { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 0 1px; }
  .app-icon { width: 17px; height: 17px; flex: none; }
  .icon-placeholder { width: 17px; height: 17px; flex: none; border-radius: 4px; background: #3f434a; }
  .card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .badge { margin-left: auto; flex: none; font-size: 10px; font-weight: 700; color: #c7ccd3; background: #1e1f22; border-radius: 999px; padding: 2px 7px; }
  footer {
    flex: none; display: flex; align-items: center; gap: 10px;
    padding: 14px 24px; border-top: 1px solid var(--border); background: #1a1b1e;
  }
  footer .spacer { flex: 1; }
  button { font-family: inherit; }
  .ghost, .secondary, .primary {
    border-radius: 7px; padding: 8px 15px; font-size: 13px; font-weight: 600;
    cursor: pointer; border: 1px solid transparent; transition: background .12s, border-color .12s, opacity .12s;
  }
  .secondary { background: transparent; border-color: var(--border); color: var(--text); }
  .secondary:hover { background: var(--panel); }
  .primary { background: var(--accent); color: #fff; }
  .primary:hover { background: var(--accent-hover); }
  .primary:disabled { opacity: .4; cursor: not-allowed; }
  .ghost { background: var(--panel); border-color: var(--border); color: var(--text); padding: 7px 11px; font-size: 12px; }
  .ghost:hover:not(:disabled) { background: var(--panel-2); }
  .ghost:disabled { opacity: .4; cursor: not-allowed; }
  .ghost[aria-expanded="true"] { border-color: var(--accent); }
  .sound-toggle { display: flex; align-items: center; gap: 8px; padding: 5px 2px; cursor: pointer; font-size: 12.5px; }
  .sound-toggle input { width: 16px; height: 16px; accent-color: var(--green); cursor: pointer; }
  .sound-toggle input:disabled { cursor: not-allowed; }
  #audio-controls { display: flex; align-items: center; gap: 10px; }
  #backdrop { position: fixed; inset: 0; z-index: 10; background: transparent; }
  #audio-panel {
    position: fixed; left: 24px; bottom: 66px; z-index: 11; width: 390px;
    max-height: min(430px, calc(100vh - 160px));
    display: flex; flex-direction: column;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 11px; box-shadow: 0 18px 48px rgba(0,0,0,.6); overflow: hidden;
  }
  .panel-head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 14px 11px; border-bottom: 1px solid var(--border); }
  .panel-head h2 { margin: 0; font-size: 13px; font-weight: 700; }
  .panel-head p { margin: 4px 0 0; font-size: 11.5px; color: var(--muted); line-height: 1.45; }
  .icon-button {
    appearance: none; border: 0; background: transparent; color: var(--muted);
    cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 4px; border-radius: 4px;
  }
  .icon-button:hover { background: #3a3d41; color: var(--text); }
  .apps { overflow-y: auto; padding: 6px; min-height: 54px; }
  .apps .status { color: var(--muted); text-align: center; font-size: 12px; padding: 18px 12px; }
  .app-row {
    display: flex; align-items: center; gap: 9px; padding: 8px 9px;
    border-radius: 7px; cursor: pointer;
  }
  .app-row:hover { background: #35373c; }
  .app-row.locked { cursor: default; opacity: .82; }
  .app-row.locked:hover { background: transparent; }
  .app-row input { width: 16px; height: 16px; flex: none; accent-color: var(--green); cursor: inherit; }
  .app-row img { width: 18px; height: 18px; flex: none; }
  .app-row .noicon { width: 18px; height: 18px; flex: none; border-radius: 4px; background: #3f434a; }
  .app-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .app-hint { flex: none; font-size: 10px; color: var(--muted); }
</style>
</head>
<body>
  <header>
    <div class="title-row">
      <div>
        <h1>O que você quer compartilhar?</h1>
        <p class="sub">A tela escolhida será transmitida para a sala.</p>
      </div>
      <span class="brand">Freehub</span>
    </div>
    <nav role="tablist">
      <button type="button" id="tab-screen" role="tab" aria-selected="true" data-tab="screen">Telas</button>
      <button type="button" id="tab-window" role="tab" aria-selected="false" data-tab="window">Janelas</button>
    </nav>
  </header>

  <main id="grid"><div class="loading">Buscando telas e janelas…</div></main>

  <footer>
    <div id="audio-controls" hidden>
      <label class="sound-toggle">
        <input type="checkbox" id="audio-toggle" />
        <span>Compartilhar som da tela</span>
      </label>
      <button type="button" id="audio-settings" class="ghost" aria-expanded="false" hidden>
        Apps com som<span id="audio-count"></span>
      </button>
    </div>
    <div class="spacer"></div>
    <button type="button" id="cancel" class="secondary">Cancelar</button>
    <button type="button" id="confirm" class="primary" disabled>Compartilhar</button>
  </footer>

  <div id="backdrop" hidden></div>
  <section id="audio-panel" hidden role="dialog" aria-modal="false" aria-label="Som dos aplicativos">
    <div class="panel-head">
      <div>
        <h2>Som de quais apps?</h2>
        <p>Desmarque um app para o som dele ficar fora da transmissão. Você continua ouvindo normalmente, e o som do próprio Freehub nunca entra.</p>
      </div>
      <button type="button" id="close-panel" class="icon-button" aria-label="Fechar">×</button>
    </div>
    <div class="apps" id="audio-apps"></div>
  </section>

<script>
(function () {
  var grid = document.getElementById('grid');
  var confirmButton = document.getElementById('confirm');
  var cancelButton = document.getElementById('cancel');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('nav button'));
  var audioControls = document.getElementById('audio-controls');
  var audioToggle = document.getElementById('audio-toggle');
  var audioButton = document.getElementById('audio-settings');
  var audioCount = document.getElementById('audio-count');
  var audioPanel = document.getElementById('audio-panel');
  var audioApps = document.getElementById('audio-apps');
  var backdrop = document.getElementById('backdrop');
  var closePanelButton = document.getElementById('close-panel');

  var sources = [];
  var tab = 'screen';
  var selectedId = null;
  var muted = null;
  var listed = null;
  var appsLoaded = false;
  var audioSupported = false;
  var perApp = false;
  var sent = false;

  function sendChoice(choice) {
    if (sent) return;
    sent = true;
    window.pickerApi.choose(choice);
  }

  function shareSelected(id) {
    if (!id || sent) return;
    var choice = { id: id };
    if (audioSupported) {
      choice.audio = { enabled: audioToggle.checked };
      if (appsLoaded && muted) {
        choice.audio.muted = muted;
        choice.audio.listed = listed;
      }
    }
    sendChoice(choice);
  }

  function cancel() {
    sendChoice(null);
  }

  function setTab(next) {
    tab = next;
    tabs.forEach(function (button) {
      button.setAttribute('aria-selected', String(button.getAttribute('data-tab') === next));
    });
    render();
  }

  function render() {
    grid.textContent = '';
    var visible = sources.filter(function (source) { return source.kind === tab; });
    if (visible.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = tab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta.';
      grid.appendChild(empty);
      return;
    }

    visible.forEach(function (source) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.setAttribute('aria-selected', String(source.id === selectedId));

      if (source.thumbnail) {
        var image = document.createElement('img');
        image.className = 'thumb';
        image.src = source.thumbnail;
        image.alt = '';
        card.appendChild(image);
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'thumb placeholder';
        placeholder.textContent = source.kind === 'screen' ? '🖥' : '▣';
        card.appendChild(placeholder);
      }

      var label = document.createElement('div');
      label.className = 'card-label';
      if (source.appIcon) {
        var appIcon = document.createElement('img');
        appIcon.className = 'app-icon';
        appIcon.src = source.appIcon;
        appIcon.alt = '';
        label.appendChild(appIcon);
      } else {
        var iconPlaceholder = document.createElement('span');
        iconPlaceholder.className = 'icon-placeholder';
        label.appendChild(iconPlaceholder);
      }
      var name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = source.name;
      name.title = source.name;
      label.appendChild(name);
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = source.kind === 'screen' ? 'Tela' : 'Janela';
      label.appendChild(badge);
      card.appendChild(label);

      card.addEventListener('click', function () {
        selectedId = source.id;
        confirmButton.disabled = false;
        render();
      });
      card.addEventListener('dblclick', function () {
        selectedId = source.id;
        shareSelected(source.id);
      });
      grid.appendChild(card);
    });
  }

  function setStatus(text) {
    audioApps.textContent = '';
    var status = document.createElement('p');
    status.className = 'status';
    status.textContent = text;
    audioApps.appendChild(status);
  }

  function updateCount() {
    var count = muted ? muted.length : 0;
    audioCount.textContent = count > 0 ? ' (' + count + ')' : '';
  }

  function renderApps(apps) {
    audioApps.textContent = '';
    if (apps.length === 0) {
      setStatus('Nenhum app aberto agora.');
      return;
    }

    apps.forEach(function (entry) {
      var row = document.createElement('label');
      row.className = 'app-row' + (entry.locked ? ' locked' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !entry.muted;
      box.disabled = entry.locked;
      box.addEventListener('change', function () {
        if (!muted) return;
        if (box.checked) {
          muted = muted.filter(function (key) { return key !== entry.key; });
        } else if (muted.indexOf(entry.key) === -1) {
          muted.push(entry.key);
        }
        updateCount();
      });
      row.appendChild(box);

      if (entry.icon) {
        var icon = document.createElement('img');
        icon.src = entry.icon;
        icon.alt = '';
        row.appendChild(icon);
      } else {
        var fallback = document.createElement('span');
        fallback.className = 'noicon';
        row.appendChild(fallback);
      }

      var name = document.createElement('span');
      name.className = 'app-name';
      name.textContent = entry.name;
      name.title = entry.name;
      row.appendChild(name);

      if (entry.locked) {
        var hint = document.createElement('span');
        hint.className = 'app-hint';
        hint.textContent = 'sempre fora';
        hint.title = 'O áudio do próprio Freehub nunca é transmitido — é o que evita o eco na sala.';
        row.appendChild(hint);
      }

      audioApps.appendChild(row);
    });
  }

  function loadApps() {
    if (appsLoaded) return;
    appsLoaded = true;
    setStatus('Procurando apps abertos…');
    window.pickerApi.audioApps().then(
      function (apps) {
        var switchable = apps.filter(function (entry) { return !entry.locked; });
        listed = switchable.map(function (entry) { return entry.key; });
        muted = switchable
          .filter(function (entry) { return entry.muted; })
          .map(function (entry) { return entry.key; });
        renderApps(apps);
        updateCount();
      },
      function () {
        appsLoaded = false;
        setStatus('Não foi possível ler a lista de apps. Tente abrir de novo.');
      }
    );
  }

  function openPanel(open) {
    audioPanel.hidden = !open;
    backdrop.hidden = !open;
    audioButton.setAttribute('aria-expanded', String(open));
    if (open) loadApps();
  }

  function updateAudioState() {
    audioButton.disabled = !audioToggle.checked;
    if (!audioToggle.checked) openPanel(false);
  }

  tabs.forEach(function (button) {
    button.addEventListener('click', function () {
      setTab(button.getAttribute('data-tab'));
    });
  });

  audioButton.addEventListener('click', function () {
    openPanel(audioPanel.hidden);
  });
  closePanelButton.addEventListener('click', function () {
    openPanel(false);
  });
  backdrop.addEventListener('click', function () {
    openPanel(false);
  });
  audioToggle.addEventListener('change', updateAudioState);

  confirmButton.addEventListener('click', function () {
    if (selectedId) shareSelected(selectedId);
  });
  cancelButton.addEventListener('click', cancel);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (!audioPanel.hidden) {
        openPanel(false);
        return;
      }
      cancel();
      return;
    }
    if (event.key === 'Enter' && selectedId && audioPanel.hidden) {
      shareSelected(selectedId);
    }
  });

  window.pickerApi.list().then(function (data) {
    sources = data.sources;
    selectedId = data.selectedId;
    confirmButton.disabled = !selectedId;

    audioSupported = Boolean(data.audio && data.audio.supported);
    perApp = Boolean(data.audio && data.audio.perApp);
    audioControls.hidden = !audioSupported;
    if (audioSupported) {
      audioToggle.checked = data.audio.enabled;
      audioButton.hidden = !perApp;
      updateAudioState();
    }

    var preselected = selectedId
      ? sources.filter(function (source) { return source.id === selectedId; })[0]
      : null;
    if (preselected && preselected.kind === 'window') {
      tab = 'window';
    } else if (!sources.some(function (source) { return source.kind === 'screen'; })) {
      tab = 'window';
    }
    tabs.forEach(function (button) {
      button.setAttribute('aria-selected', String(button.getAttribute('data-tab') === tab));
    });

    render();
    if (selectedId) {
      var chosen = grid.querySelector('.card[aria-selected="true"]');
      if (chosen && chosen.scrollIntoView) chosen.scrollIntoView({ block: 'nearest' });
    }
  });
})();
</script>
</body>
</html>`;
}
