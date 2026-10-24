import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PickerAudioApp, PickerChoice, PickerData } from '../shared/picker';

const api = {
  list: (): Promise<PickerData> => ipcRenderer.invoke(IPC.pickerList),
  audioApps: (): Promise<PickerAudioApp[]> =>
    ipcRenderer.invoke(IPC.pickerAudioApps),
  choose: (choice: PickerChoice | null): void =>
    ipcRenderer.send(IPC.pickerChoose, choice),
};

contextBridge.exposeInMainWorld('pickerApi', api);

export type PickerApi = typeof api;
