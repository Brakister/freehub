import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface SharePreferences {
  lastSourceId: string | null;
}

const FILE_NAME = 'share-preferences.json';
let cached: SharePreferences | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function read(): SharePreferences {
  if (cached) return cached;
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    // Primeiro compartilhamento.
  }
  const record = (stored ?? {}) as Record<string, unknown>;
  cached = {
    lastSourceId:
      typeof record.lastSourceId === 'string' ? record.lastSourceId : null,
  };
  return cached;
}

export function getLastShareSourceId(): string | null {
  return read().lastSourceId;
}

export function saveLastShareSourceId(id: string | null): void {
  cached = { lastSourceId: id };
  try {
    writeFileSync(settingsPath(), `${JSON.stringify(cached, null, 2)}\n`, 'utf8');
  } catch {
    // Preferência best-effort.
  }
}
