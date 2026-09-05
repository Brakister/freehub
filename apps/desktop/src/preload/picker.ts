import { contextBridge, ipcRenderer } from 'electron';

export interface PickerSource {
  id: string;
  name: string;
  thumbnail: string;
}

const api = {
  list: (): Promise<PickerSource[]> => ipcRenderer.invoke('picker:list'),
  select: (id: string): void => ipcRenderer.send('picker:select', id),
  cancel: (): void => ipcRenderer.send('picker:cancel'),
};

contextBridge.exposeInMainWorld('pickerApi', api);

export type PickerApi = typeof api;