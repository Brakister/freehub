import { io, type Socket } from 'socket.io-client';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001') as string;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
  }
  return socket;
}

export function getServerUrl(): string {
  return SERVER_URL;
}
