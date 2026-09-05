export interface User {
  id: string;
  nickname: string;
  muted: boolean;
  joinTime: number;
  /** True quando este usuário está compartilhando a tela */
  sharingScreen: boolean;
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

export interface RoomState {
  room: Room;
  users: User[];
  /** Duração da sessão de compartilhamento atual, se houver */
  screenshare: {
    userId: string;
    startedAt: number;
  } | null;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface AppError {
  message: string;
}
