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
}

interface SettingsState extends Settings {
  setNickname(nickname: string): void;
  setInputDeviceId(inputDeviceId: string): void;
  setOutputDeviceId(outputDeviceId: string): void;
  setMicGain(value: number): void;
  setSpeakerVolume(value: number): void;
}

export const DEFAULT_SETTINGS: Settings = {
  nickname: 'Usuário',
  inputDeviceId: '',
  outputDeviceId: '',
  micGain: 1,
  speakerVolume: 1,
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
    }),
    {
      name: 'discord3-settings',
      version: 1,
    },
  ),
);
