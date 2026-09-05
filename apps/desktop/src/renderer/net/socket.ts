import { io, type Socket } from 'socket.io-client';
import { useSettings } from '@freehub/ui';

const DEFAULT_SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001') as string;

let socket: Socket | null = null;
let socketUrl = '';

export function resolveServerUrl(): string {
  const custom = (useSettings.getState().serverUrl ?? '').trim();
  return custom || DEFAULT_SERVER_URL;
}

export function getSocket(): Socket {
  const url = resolveServerUrl();
  if (socket && socketUrl !== url) {
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
    socketUrl = url;
  }
  return socket;
}

export function getServerUrl(): string {
  return resolveServerUrl();
}