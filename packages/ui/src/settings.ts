import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Settings {
  nickname: string;
  inputDeviceId: string;
  outputDeviceId: string;
  /** Ganho do microfone (0..1). */
  micGain: number;
  /** Volume do alto-falante (0..1). */
  speakerVolume: number;
  /** URL do servidor de voz. Vazio = padrão (localhost). */
  serverUrl: string;
}

interface SettingsState extends Settings {
  setNickname(nickname: string): void;
  setInputDeviceId(inputDeviceId: string): void;
  setOutputDeviceId(outputDeviceId: string): void;
  setMicGain(value: number): void;
  setSpeakerVolume(value: number): void;
  setServerUrl(value: string): void;
}

export const DEFAULT_SETTINGS: Settings = {
  nickname: 'Usuário',
  inputDeviceId: '',
  outputDeviceId: '',
  micGain: 1,
  speakerVolume: 1,
  serverUrl: '',
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setNickname: (nickname) => set({ nickname }),
      setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setMicGain: (micGain) => set({ micGain }),
      setSpeakerVolume: (speakerVolume) => set({ speakerVolume }),
      setServerUrl: (serverUrl) => set({ serverUrl }),
    }),
    {
      name: 'freehub-settings',
      version: 2,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return { ...current, ...p, serverUrl: p.serverUrl ?? '' };
      },
    },
  ),
);
