/// <reference types="vite/client" />
import type { FreehubAPI } from '../preload';

declare global {
  interface Window {
    electronAPI?: FreehubAPI;
  }
  interface ImportMetaEnv {
    readonly VITE_SERVER_URL?: string;
    readonly VITE_UPDATE_SERVER_URL?: string;
  }
}

export {};
