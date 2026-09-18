import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SCREEN_QUALITY_ID } from '@freehub/shared';

export interface Settings {
  nickname: string;
  inputDeviceId: string;
  outputDeviceId: string;
  /** Ganho do microfone (0..1). */
  micGain: number;
  /** Volume do alto-falante (0..1). */
  speakerVolume: number;
  /** URL do servidor de voz. Vazio = servidor público padrão. */
  serverUrl: string;
  /** Qualidade da tela compartilhada (id em SCREEN_QUALITIES). */
  screenQualityId: string;
  /** Capturar áudio do sistema ao compartilhar tela. */
  captureSystemAudio: boolean;
}

interface SettingsState extends Settings {
  setNickname(nickname: string): void;
  setInputDeviceId(inputDeviceId: string): void;
  setOutputDeviceId(outputDeviceId: string): void;
  setMicGain(value: number): void;
  setSpeakerVolume(value: number): void;
  setServerUrl(value: string): void;
  setScreenQualityId(value: string): void;
  setCaptureSystemAudio(value: boolean): void;
}

export const DEFAULT_SETTINGS: Settings = {
  nickname: 'Usuário',
  inputDeviceId: '',
  outputDeviceId: '',
  micGain: 1,
  speakerVolume: 1,
  serverUrl: '',
  screenQualityId: DEFAULT_SCREEN_QUALITY_ID,
  captureSystemAudio: true,
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
      setScreenQualityId: (screenQualityId) => set({ screenQualityId }),
      setCaptureSystemAudio: (captureSystemAudio) => set({ captureSystemAudio }),
    }),
    {
      name: 'freehub-settings',
      version: 3,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return {
          ...current,
          ...p,
          serverUrl: p.serverUrl ?? '',
          screenQualityId: p.screenQualityId ?? DEFAULT_SCREEN_QUALITY_ID,
          captureSystemAudio: p.captureSystemAudio ?? true,
        };
      },
    },
  ),
);
