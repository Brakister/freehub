// Contrato compartilhado entre main, preload e renderer.

export const SYSTEM_AUDIO_FORMAT = {
  sampleRate: 48000,
  channels: 2,
  bitsPerSample: 16,
} as const;

export const IPC = {
  systemAudioStart: 'freehub:system-audio:start',
  systemAudioStop: 'freehub:system-audio:stop',
  systemAudioState: 'freehub:system-audio:state',
  systemAudioData: 'freehub:system-audio:data',
  systemAudioEnded: 'freehub:system-audio:ended',
  systemAudioSetEnabled: 'freehub:system-audio:set-enabled',

  pickerList: 'freehub:picker:list',
  pickerAudioApps: 'freehub:picker:audio-apps',
  pickerChoose: 'freehub:picker:choose',
} as const;
