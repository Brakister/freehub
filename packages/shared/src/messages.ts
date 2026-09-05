import type { RoomState, User } from './types';

export interface CreateRoomPayload {
  nickname: string;
  roomName: string;
}

export interface JoinRoomPayload {
  roomId: string;
  nickname: string;
}

export interface RoomCreatedPayload {
  room: {
    id: string;
    name: string;
  };
  /** Id do usuário que criou (o próprio cliente). */
  selfId: string;
}

export type UserJoinedPayload = User;

export interface UserLeftPayload {
  userId: string;
}

export interface RoomJoinedPayload extends RoomState {
  /** Id do usuário que entrou (o próprio cliente). */
  selfId: string;
}

export interface UserMutedPayload {
  userId: string;
  muted: boolean;
}

export interface ScreenSharedPayload {
  userId: string;
}

export interface ScreenStoppedPayload {
  userId: string;
}

export interface ErrorPayload {
  message: string;
  code: string;
}

export interface SignalingPayload {
  /** Id do peer de destino */
  targetUserId: string;
  signal: unknown;
}

export interface PingPayload {
  timestamp: number;
}
