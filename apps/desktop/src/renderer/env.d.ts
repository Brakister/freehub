/// <reference types="vite/client" />
import type { Discord3API } from '../preload';

declare global {
  interface Window {
    electronAPI?: Discord3API;
  }
  interface ImportMetaEnv {
    readonly VITE_SERVER_URL?: string;
    readonly VITE_UPDATE_SERVER_URL?: string;
  }
}

export {};
