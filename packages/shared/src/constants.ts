export const APP_NAME = 'Freehub';

export const MAX_ROOM_USERS = 6;
export const MAX_NICKNAME_LENGTH = 24;
export const MIN_NICKNAME_LENGTH = 1;

export const SERVER_PORT = 3001;

export const ICE_SERVERS: { urls: string[] }[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

export interface ScreenQualityOption {
  id: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export const SCREEN_QUALITIES: ScreenQualityOption[] = [
  { id: '720p30', label: '720p · 30 FPS', width: 1280, height: 720, frameRate: 30 },
  { id: '1080p30', label: '1080p · 30 FPS', width: 1920, height: 1080, frameRate: 30 },
  { id: '1080p60', label: '1080p · 60 FPS', width: 1920, height: 1080, frameRate: 60 },
  { id: '1440p60', label: '1440p · 60 FPS', width: 2560, height: 1440, frameRate: 60 },
  { id: '4k60', label: '4K · 60 FPS', width: 3840, height: 2160, frameRate: 60 },
];

export const DEFAULT_SCREEN_QUALITY_ID = '1080p60';
