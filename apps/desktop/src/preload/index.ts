import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, SYSTEM_AUDIO_FORMAT } from '../shared/ipc';

export interface AppInfo {
  version: string;
  platform: string;
}

export interface SystemAudioState {
  supported: boolean;
  active: boolean;
  enabled: boolean;
}

export interface UpdateStatus {
  status:
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  message: string;
  percent?: number;
  version?: string;
}

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),

  // ---- Auto-update (ver Etapa 7) ----
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },

  // ---- Áudio do sistema por processo ----
  systemAudio: {
    format: { ...SYSTEM_AUDIO_FORMAT },

    /**
     * Inicia a captura nativa. O argumento `enabled` sincroniza a escolha
     * persistida com o switch das configurações do app.
     */
    start: (options?: { enabled?: boolean }): Promise<boolean> =>
      ipcRenderer.invoke(IPC.systemAudioStart, {
        enabled:
          typeof options?.enabled === 'boolean' ? options.enabled : undefined,
      }),

    stop: (): void => ipcRenderer.send(IPC.systemAudioStop),

    getState: (): Promise<SystemAudioState> =>
      ipcRenderer.invoke(IPC.systemAudioState),

    setEnabled: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.systemAudioSetEnabled, enabled === true),

    /** PCM s16le, 48 kHz, estéreo — ver SYSTEM_AUDIO_FORMAT. */
    onData: (cb: (chunk: Uint8Array) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, chunk: unknown): void => {
        if (chunk instanceof Uint8Array) cb(chunk);
      };
      ipcRenderer.on(IPC.systemAudioData, listener);
      return () => ipcRenderer.removeListener(IPC.systemAudioData, listener);
    },

    onEnded: (cb: () => void): (() => void) => {
      const listener = (): void => cb();
      ipcRenderer.on(IPC.systemAudioEnded, listener);
      return () => ipcRenderer.removeListener(IPC.systemAudioEnded, listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type FreehubAPI = typeof api;
