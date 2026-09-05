import type { Server, Socket } from 'socket.io';
import type { User } from '@freehub/shared';
import { ClientEvent, ServerEvent } from '@freehub/shared';
import { DatabaseStore, type RoomRow } from './db';
import { randomUUID } from 'node:crypto';

interface LiveUser extends User {
  socketId: string;
}

interface RoomSession {
  room: RoomRow;
  users: Map<string, LiveUser>;
}

/**
 * Mantém o estado de sessão em memória (baseado no id do socket) e coordena
 * o envio de eventos e o relé de signaling entre os peers.
 */
export class RoomManager {
  private db: DatabaseStore;
  private io: Server;
  private sessions = new Map<string, RoomSession>();

  constructor(db: DatabaseStore, io: Server) {
    this.db = db;
    this.io = io;
  }

  createRoom(socket: Socket, nickname: string, roomName: string): void {
    this.leaveRoom(socket);

    const owner: LiveUser = {
      id: randomUUID(),
      nickname,
      muted: false,
      sharingScreen: false,
      joinTime: Date.now(),
      socketId: socket.id,
    };
    const room = this.db.createRoom(roomName, owner.id);
    this.db.addUser(room.id, owner);
    this.sessions.set(room.id, { room, users: new Map([[owner.id, owner]]) });
    socket.data.userId = owner.id;
    socket.data.roomId = room.id;
    socket.join(room.id);

    socket.emit(ServerEvent.roomCreated, {
      room: { id: room.id, name: room.name },
      selfId: owner.id,
    });
  }

  joinRoom(socket: Socket, roomId: string, nickname: string): void {
    this.leaveRoom(socket);

    const room = this.db.getRoom(roomId);
    if (!room) {
      socket.emit(ServerEvent.roomNotFound, {
        message: 'Sala não encontrada',
        code: 'ROOM_NOT_FOUND',
      });
      return;
    }

    if (this.currentUserCount(roomId) >= 6) {
      socket.emit(ServerEvent.roomFull, { message: 'Sala cheia', code: 'ROOM_FULL' });
      return;
    }

    const user: LiveUser = {
      id: randomUUID(),
      nickname,
      muted: false,
      sharingScreen: false,
      joinTime: Date.now(),
      socketId: socket.id,
    };

    let session = this.sessions.get(roomId);
    if (!session) {
      session = { room, users: new Map() };
      this.sessions.set(roomId, session);
    }
    session.users.set(user.id, user);
    this.db.addUser(roomId, user);

    socket.data.userId = user.id;
    socket.data.roomId = roomId;
    socket.join(roomId);

    const users = [...session.users.values()].map(this.toUser);
    socket.emit(ServerEvent.roomJoined, {
      room: { id: room.id, name: room.name },
      users,
      screenshare: this.findScreenshare(session),
      selfId: user.id,
    });

    socket.to(roomId).emit(ServerEvent.userJoined, this.toUser(user));
  }

  leaveRoom(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;

    const session = this.sessions.get(roomId);
    if (session) {
      session.users.delete(userId);
      this.io.to(roomId).emit(ServerEvent.userLeft, { userId });
    }
    this.db.removeUser(userId);
    socket.leave(roomId);
    socket.data.userId = undefined;
    socket.data.roomId = undefined;

    if (session && (session.users.size === 0 || session.room.owner_id === userId)) {
      this.sessions.delete(roomId);
      this.db.deleteRoom(roomId);
    }
  }

  disconnect(socket: Socket): void {
    this.leaveRoom(socket);
  }

  toggleMute(socket: Socket, muted: boolean): void {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;
    this.db.setMuted(userId, muted);
    this.io.to(roomId).emit(ServerEvent.userMuted, { userId, muted });
  }

  findCurrentSharer(roomId: string): LiveUser | null {
    const session = this.sessions.get(roomId);
    if (!session) return null;
    return [...session.users.values()].find((u) => u.sharingScreen) ?? null;
  }

  startScreenShare(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;
    const session = this.sessions.get(roomId);
    if (!session) return;
    const current = this.findCurrentSharer(roomId);
    if (current && current.id !== userId) {
      socket.emit(ServerEvent.screenShareDenied, {
        sharerId: current.id,
        sharerNickname: current.nickname,
        message: 'Outra pessoa já está transmitindo. Peça para ela parar ou espere.',
      });
      return;
    }
    for (const u of session.users.values()) u.sharingScreen = u.id === userId;
    this.db.setSharingScreen(userId, true);
    this.io.to(roomId).emit(ServerEvent.screenShared, { userId });
  }

  requestStopScreenShare(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;
    const current = this.findCurrentSharer(roomId);
    if (!current || current.id === userId) return;
    const requester = this.sessions.get(roomId)?.users.get(userId);
    this.io.to(current.socketId).emit(ServerEvent.screenShareRequested, {
      requesterId: userId,
      requesterNickname: requester?.nickname ?? 'Alguém',
    });
  }

  stopScreenShare(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;
    const session = this.sessions.get(roomId);
    if (session) {
      for (const u of session.users.values()) u.sharingScreen = false;
    }
    this.db.setSharingScreen(userId, false);
    this.io.to(roomId).emit(ServerEvent.screenStopped, { userId });
  }

  relaySignal(socket: Socket, payload: { targetUserId: string; signal: unknown }): void {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const session = this.sessions.get(roomId);
    if (!session) return;
    const target = session.users.get(payload.targetUserId);
    if (!target) return;
    this.io
      .to(target.socketId)
      .emit(ServerEvent.signaling, { targetUserId: socket.data.userId, signal: payload.signal });
  }

  private currentUserCount(roomId: string): number {
    const session = this.sessions.get(roomId);
    if (session) return session.users.size;
    return this.db.getUsers(roomId).length;
  }

  private findScreenshare(session: RoomSession): { userId: string; startedAt: number } | null {
    const sharer = [...session.users.values()].find((u) => u.sharingScreen);
    return sharer ? { userId: sharer.id, startedAt: sharer.joinTime } : null;
  }

  private toUser(u: LiveUser): User {
    return {
      id: u.id,
      nickname: u.nickname,
      muted: u.muted,
      sharingScreen: u.sharingScreen,
      joinTime: u.joinTime,
    };
  }
}

export function registerSocketHandlers(io: Server, manager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    socket.on(ClientEvent.createRoom, (payload: { nickname: string; roomName: string }) => {
      manager.createRoom(socket, payload?.nickname ?? 'Usuário', payload?.roomName ?? 'Nova sala');
    });

    socket.on(ClientEvent.joinRoom, (payload: { roomId: string; nickname: string }) => {
      manager.joinRoom(
        socket,
        String(payload?.roomId ?? '').toUpperCase(),
        payload?.nickname ?? 'Usuário',
      );
    });

    socket.on(ClientEvent.toggleMute, (muted: boolean) => {
      manager.toggleMute(socket, Boolean(muted));
    });

    socket.on(ClientEvent.startScreenShare, () => manager.startScreenShare(socket));
    socket.on(ClientEvent.stopScreenShare, () => manager.stopScreenShare(socket));
    socket.on(ClientEvent.requestStopScreenShare, () => manager.requestStopScreenShare(socket));

    socket.on(ClientEvent.signaling, (payload: { targetUserId: string; signal: unknown }) => {
      manager.relaySignal(socket, payload);
    });

    socket.on(ClientEvent.leaveRoom, () => manager.leaveRoom(socket));
    socket.on('disconnect', () => manager.disconnect(socket));
  });
}
