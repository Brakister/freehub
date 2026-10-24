import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface SystemAudioSettings {
  /** A transmissão leva o som do sistema. */
  enabled: boolean;
  /** Executáveis (minúsculos) cujo som fica de fora. */
  mutedApps: string[];
}

const FILE_NAME = 'system-audio.json';
let cached: SystemAudioSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

/** Reduz qualquer entrada a um nome de executável válido e sem duplicatas. */
export function normalizeAppKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = path.basename(entry.trim()).toLowerCase();
    if (name.length > 0 && name.length <= 260) seen.add(name);
  }
  return [...seen];
}

export function getSystemAudioSettings(): SystemAudioSettings {
  if (cached) return cached;
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    // Arquivo ainda não existe (caso normal) ou está corrompido.
  }
  const record = (stored ?? {}) as Record<string, unknown>;
  cached = {
    enabled: record.enabled !== false,
    mutedApps: normalizeAppKeys(record.mutedApps),
  };
  return cached;
}

export function saveSystemAudioSettings(
  patch: Partial<SystemAudioSettings>,
): SystemAudioSettings {
  const current = getSystemAudioSettings();
  const next: SystemAudioSettings = {
    enabled:
      typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    mutedApps:
      patch.mutedApps !== undefined
        ? normalizeAppKeys(patch.mutedApps)
        : current.mutedApps,
  };
  cached = next;
  try {
    writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    // Sem disco gravação: a escolha ainda vale para esta sessão.
  }
  return next;
}
