// Tipos do seletor de tela, compartilhados com o preload do seletor.

export interface PickerSource {
  id: string;
  name: string;
  /** PNG em data URL. */
  thumbnail: string;
  kind: 'screen' | 'window';
  /** Ícone do aplicativo, quando o Windows fornece. */
  appIcon: string | null;
}

export interface PickerAudioApp {
  /** Nome do executável em minúsculas; é a chave persistida. */
  key: string;
  name: string;
  /** PNG em data URL. */
  icon: string | null;
  /** O som deste app fica fora da transmissão. */
  muted: boolean;
  /** O próprio Freehub: sempre fora, sem opção de mudar. */
  locked: boolean;
}

export interface PickerData {
  sources: PickerSource[];
  selectedId: string | null;
  audio: {
    supported: boolean;
    perApp: boolean;
    enabled: boolean;
  };
}

export interface PickerChoice {
  id: string | null;
  audio?: {
    enabled: boolean;
    /** Ausente = o painel não foi aberto; não alterar a lista salva. */
    muted?: string[];
    /** Apps que o painel mostrou; os demais são preservados. */
    listed?: string[];
  };
}
