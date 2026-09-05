import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { app } from 'electron';
import initSqlJs, { type Database } from 'sql.js';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'node:crypto';

/* ---- constants (inlined from @freehub/shared) ---- */
const SERVER_PORT = 3001;
const MAX_ROOM_USERS = 6;

const ClientEvent = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  toggleMute: 'user:mute',
  startScreenShare: 'screen:start',
  stopScreenShare: 'screen:stop',
  requestStopScreenShare: 'screen:request-stop',
  signaling: 'signaling:relay',
} as const;

const ServerEvent = {
  roomCreated: 'room:created',
  roomJoined: 'room:joined',
  roomFull: 'room:full',
  roomNotFound: 'room:not-found',
  userJoined: 'user:joined',
  userLeft: 'user:left',
  userMuted: 'user:muted',
  screenShared: 'screen:shared',
  screenStopped: 'screen:stopped',
  screenShareDenied: 'screen:share-denied',
  screenShareRequested: 'screen:requested',
  signaling: 'signaling:relay',
  error: 'error',
} as const;

/* ---- room state (SQLite em memória via sql.js) ---- */
interface RoomRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

interface LiveUser {
  id: string;
  nickname: string;
  muted: boolean;
  sharingScreen: boolean;
  joinTime: number;
  socketId: string;
}

interface RoomSession {
  room: RoomRow;
  users: Map<string, LiveUser>;
}

let dbPromise: Promise<Database> | null = null;

function findSqlWasm(): Buffer | null {
  const candidates: string[] = [];
  try {
    candidates.push(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm'));
  } catch {
    /* resolve via fallbacks abaixo */
  }
  candidates.push(
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate);
  }
  return null;
}

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    const wasmBinary = findSqlWasm();
    const initSql = wasmBinary
      ? await initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer })
      : await initSqlJs({ locateFile: (file: string) => path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file) });
    const db = new initSql.Database();
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        muted INTEGER NOT NULL DEFAULT 0,
        sharing_screen INTEGER NOT NULL DEFAULT 0,
        join_time INTEGER NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id)
      );
    `);
    dbPromise = Promise.resolve(db);
  }
  return dbPromise;
}

function roomExists(db: Database, id: string): boolean {
  const stmt = db.prepare('SELECT 1 FROM rooms WHERE id = ?');
  stmt.bind([id]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

function generateRoomId(db: Database): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id: string;
  do {
    id = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (roomExists(db, id));
  return id;
}

async function startServer(): Promise<void> {
  const db = await getDb();
  const sessions = new Map<string, RoomSession>();

  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: 'Freehub server (embedded)' }));

  const http = app.listen(SERVER_PORT, () => {
    console.log(`[freehub] servidor embutido em http://localhost:${SERVER_PORT}`);
  });
  http.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[freehub] porta ${SERVER_PORT} já em uso — outro servidor Freehub está rodando?`);
    } else {
      console.warn(`[freehub] falha ao iniciar servidor embutido: ${err.message}`);
    }
  });

  const io = new SocketIOServer(http, { cors: { origin: '*' } });

  const toUser = (u: LiveUser): { id: string; nickname: string; muted: boolean; sharingScreen: boolean; joinTime: number } => ({
    id: u.id,
    nickname: u.nickname,
    muted: u.muted,
    sharingScreen: u.sharingScreen,
    joinTime: u.joinTime,
  });

  const leaveRoom = (socket: import('socket.io').Socket): void => {
    const userId = socket.data.userId as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    if (!userId || !roomId) return;
    const session = sessions.get(roomId);
    if (session) {
      session.users.delete(userId);
      io.to(roomId).emit(ServerEvent.userLeft, { userId });
    }
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    socket.leave(roomId);
    socket.data.userId = undefined;
    socket.data.roomId = undefined;
    if (session && (session.users.size === 0 || session.room.owner_id === userId)) {
      sessions.delete(roomId);
      db.run('DELETE FROM users WHERE room_id = ?', [roomId]);
      db.run('DELETE FROM rooms WHERE id = ?', [roomId]);
    }
  };

  io.on('connection', (socket) => {
    socket.on(ClientEvent.createRoom, (payload: { nickname?: string; roomName?: string } = {}) => {
      leaveRoom(socket);
      const nickname = payload.nickname || 'Usuário';
      const roomName = payload.roomName || 'Nova sala';
      const owner: LiveUser = { id: randomUUID(), nickname, muted: false, sharingScreen: false, joinTime: Date.now(), socketId: socket.id };
      const roomId = generateRoomId(db);
      const now = Date.now();
      db.run('INSERT INTO rooms (id,name,owner_id,created_at) VALUES (?,?,?,?)', [roomId, roomName, owner.id, now]);
      db.run('INSERT INTO users (id,room_id,nickname,muted,sharing_screen,join_time) VALUES (?,?,?,0,0,?)', [owner.id, roomId, nickname, now]);
      sessions.set(roomId, { room: { id: roomId, name: roomName, owner_id: owner.id, created_at: now }, users: new Map([[owner.id, owner]]) });
      socket.data.userId = owner.id;
      socket.data.roomId = roomId;
      socket.join(roomId);
      socket.emit(ServerEvent.roomCreated, { room: { id: roomId, name: roomName }, selfId: owner.id });
    });

    socket.on(ClientEvent.joinRoom, (payload: { roomId?: string; nickname?: string } = {}) => {
      leaveRoom(socket);
      const roomId = String(payload.roomId ?? '').toUpperCase();
      const nickname = payload.nickname || 'Usuário';
      const rowStmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
      rowStmt.bind([roomId]);
      let row: RoomRow | undefined;
      if (rowStmt.step()) row = rowStmt.getAsObject() as unknown as RoomRow;
      rowStmt.free();
      if (!row) { socket.emit(ServerEvent.roomNotFound, { message: 'Sala não encontrada', code: 'ROOM_NOT_FOUND' }); return; }
      let session = sessions.get(roomId);
      let userCount: number;
      if (session) userCount = session.users.size;
      else {
        const c = db.prepare('SELECT COUNT(*) AS n FROM users WHERE room_id = ?');
        c.bind([roomId]);
        let count = 0;
        if (c.step()) count = (c.getAsObject() as { n: number }).n;
        c.free();
        userCount = count;
      }
      if (userCount >= MAX_ROOM_USERS) { socket.emit(ServerEvent.roomFull, { message: 'Sala cheia', code: 'ROOM_FULL' }); return; }
      if (!session) { session = { room: row, users: new Map() }; sessions.set(roomId, session); }
      const user: LiveUser = { id: randomUUID(), nickname, muted: false, sharingScreen: false, joinTime: Date.now(), socketId: socket.id };
      session.users.set(user.id, user);
      db.run('INSERT INTO users (id,room_id,nickname,muted,sharing_screen,join_time) VALUES (?,?,?,0,0,?)', [user.id, roomId, nickname, Date.now()]);
      socket.data.userId = user.id;
      socket.data.roomId = roomId;
      socket.join(roomId);
      const users = [...session.users.values()].map(toUser);
      const sharer = [...session.users.values()].find((u) => u.sharingScreen);
      socket.emit(ServerEvent.roomJoined, { room: { id: row.id, name: row.name }, users, screenshare: sharer ? { userId: sharer.id, startedAt: sharer.joinTime } : null, selfId: user.id });
      socket.to(roomId).emit(ServerEvent.userJoined, toUser(user));
    });

    socket.on(ClientEvent.leaveRoom, () => leaveRoom(socket));

    socket.on(ClientEvent.toggleMute, (muted: boolean) => {
      const userId = socket.data.userId as string | undefined;
      const roomId = socket.data.roomId as string | undefined;
      if (!userId || !roomId) return;
      db.run('UPDATE users SET muted = ? WHERE id = ?', [muted ? 1 : 0, userId]);
      io.to(roomId).emit(ServerEvent.userMuted, { userId, muted });
    });

    socket.on(ClientEvent.startScreenShare, () => {
      const userId = socket.data.userId as string | undefined;
      const roomId = socket.data.roomId as string | undefined;
      if (!userId || !roomId) return;
      const session = sessions.get(roomId);
      if (!session) return;
      const sharer = [...session.users.values()].find((u) => u.sharingScreen);
      if (sharer && sharer.id !== userId) {
        socket.emit(ServerEvent.screenShareDenied, {
          sharerId: sharer.id,
          sharerNickname: sharer.nickname,
          message: 'Outra pessoa já está transmitindo. Peça para ela parar ou espere.',
        });
        return;
      }
      for (const u of session.users.values()) u.sharingScreen = u.id === userId;
      db.run('UPDATE users SET sharing_screen = 1 WHERE id = ?', [userId]);
      io.to(roomId).emit(ServerEvent.screenShared, { userId });
    });

    socket.on(ClientEvent.stopScreenShare, () => {
      const userId = socket.data.userId as string | undefined;
      const roomId = socket.data.roomId as string | undefined;
      if (!userId || !roomId) return;
      const session = sessions.get(roomId);
      if (session) for (const u of session.users.values()) u.sharingScreen = false;
      db.run('UPDATE users SET sharing_screen = 0 WHERE id = ?', [userId]);
      io.to(roomId).emit(ServerEvent.screenStopped, { userId });
    });

    socket.on(ClientEvent.requestStopScreenShare, () => {
      const userId = socket.data.userId as string | undefined;
      const roomId = socket.data.roomId as string | undefined;
      if (!userId || !roomId) return;
      const session = sessions.get(roomId);
      if (!session) return;
      const sharer = [...session.users.values()].find((u) => u.sharingScreen);
      if (!sharer || sharer.id === userId) return;
      const requester = session.users.get(userId);
      io.to(sharer.socketId).emit(ServerEvent.screenShareRequested, {
        requesterId: userId,
        requesterNickname: requester?.nickname ?? 'Alguém',
      });
    });

    socket.on(ClientEvent.signaling, (payload: { targetUserId?: string; signal?: unknown }) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      const session = sessions.get(roomId);
      if (!session || !payload?.targetUserId) return;
      const target = session.users.get(payload.targetUserId);
      if (!target) return;
      io.to(target.socketId).emit(ServerEvent.signaling, { targetUserId: socket.data.userId, signal: payload.signal });
    });

    socket.on('disconnect', () => leaveRoom(socket));
  });
}

export { startServer };
