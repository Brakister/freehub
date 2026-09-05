import { create } from 'zustand';
import { ClientEvent, type ConnectionStatus, type RoomState, type User } from '@freehub/shared';
import { getSocket } from '../net/socket';

export interface ScreenshareInfo {
  userId: string;
  startedAt: number;
}

export interface RoomInfo {
  id: string;
  name: string;
}

interface ConnectionState {
  status: ConnectionStatus;
  connected: boolean;
  selfId: string | null;
  room: RoomInfo | null;
  users: User[];
  speaking: Record<string, boolean>;
  muted: boolean;
  screenshare: ScreenshareInfo | null;
  error: string | null;
  settingsOpen: boolean;

  markConnected(connected: boolean, status: ConnectionStatus): void;
  setError(message: string | null): void;
  applyRoomCreated(selfId: string, room: RoomInfo, nickname: string): void;
  applyRoomJoined(payload: RoomState & { selfId: string }): void;
  addUser(user: User): void;
  removeUser(userId: string): void;
  updateUserMuted(userId: string, muted: boolean): void;
  setScreenshare(info: ScreenshareInfo | null): void;
  createRoom(roomName: string, nickname: string): void;
  joinRoom(roomId: string, nickname: string): void;
  leaveRoom(): void;
  toggleMute(): void;
  setSpeaking(userId: string, speaking: boolean): void;
  reset(): void;
  openSettings(): void;
  closeSettings(): void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'connecting',
  connected: false,
  selfId: null,
  room: null,
  users: [],
  speaking: {},
  muted: false,
  screenshare: null,
  error: null,
  settingsOpen: false,

  markConnected: (connected, status) => set({ connected, status, error: null }),
  setError: (message) => set({ error: message, status: message ? 'disconnected' : get().status }),

  applyRoomCreated: (selfId, room, nickname) =>
    set({
      room,
      selfId,
      users: [
        {
          id: selfId,
          nickname,
          muted: false,
          sharingScreen: false,
          joinTime: Date.now(),
        },
      ],
      muted: false,
      screenshare: null,
      error: null,
      speaking: {},
    }),

  applyRoomJoined: (payload) =>
    set({
      room: payload.room,
      selfId: payload.selfId,
      users: payload.users,
      muted: false,
      screenshare: payload.screenshare,
      error: null,
      speaking: {},
    }),

  addUser: (user) => set((s) => ({ users: [...s.users.filter((u) => u.id !== user.id), user] })),
  removeUser: (userId) =>
    set((s) => {
      const speaking = { ...s.speaking };
      delete speaking[userId];
      return {
        users: s.users.filter((u) => u.id !== userId),
        speaking,
        screenshare: s.screenshare?.userId === userId ? null : s.screenshare,
      };
    }),

  updateUserMuted: (userId, muted) =>
    set((s) => ({
      users: s.users.map((u) => (u.id === userId ? { ...u, muted } : u)),
    })),

  setScreenshare: (screenshare) => set({ screenshare }),

  createRoom: (roomName, nickname) => {
    const socket = getSocket();
    if (!socket.connected) {
      set({ error: 'Sem conexão com o servidor de áudio.' });
      return;
    }
    set({ error: null });
    socket.emit(ClientEvent.createRoom, { nickname, roomName });
  },

  joinRoom: (roomId, nickname) => {
    const socket = getSocket();
    if (!socket.connected) {
      set({ error: 'Sem conexão com o servidor de áudio.' });
      return;
    }
    set({ error: null });
    socket.emit(ClientEvent.joinRoom, { roomId, nickname });
  },

  leaveRoom: () => {
    getSocket().emit(ClientEvent.leaveRoom);
    get().reset();
  },

  toggleMute: () => {
    const muted = !get().muted;
    getSocket().emit(ClientEvent.toggleMute, muted);
    set({ muted });
  },

  setSpeaking: (userId, speaking) =>
    set((s) => {
      if ((s.speaking[userId] ?? false) === speaking) return s;
      return { speaking: { ...s.speaking, [userId]: speaking } };
    }),

  reset: () =>
    set({
      selfId: null,
      room: null,
      users: [],
      speaking: {},
      muted: false,
      screenshare: null,
      error: null,
    }),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
