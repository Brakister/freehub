import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface AppInfo {
  version: string;
  platform: string;
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
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type FreehubAPI = typeof api;
