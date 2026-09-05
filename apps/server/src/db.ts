import Database from 'better-sqlite3';
import { isRoomId } from '@discord3/shared';

export interface RoomRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

export interface UserRow {
  id: string;
  room_id: string;
  nickname: string;
  muted: number;
  sharing_screen: number;
  join_time: number;
}

/**
 * Camada de acesso a dados baseada em SQLite. Persistimos apenas dados
 * estáveis (salas e usuários). O estado de conexão/WebRTC é mantido em
 * memória pelo gerenciador de salas.
 */
export class DatabaseStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
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
  }

  createRoom(name: string, ownerId: string): RoomRow {
    const id = this.generateRoomId();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO rooms (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, ownerId, now);
    return { id, name, owner_id: ownerId, created_at: now };
  }

  getRoom(id: string): RoomRow | undefined {
    return this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
  }

  deleteRoom(id: string): void {
    this.db.prepare('DELETE FROM users WHERE room_id = ?').run(id);
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  }

  addUser(roomId: string, user: { id: string; nickname: string }): UserRow {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, room_id, nickname, muted, sharing_screen, join_time) VALUES (?, ?, ?, 0, 0, ?)',
      )
      .run(user.id, roomId, user.nickname, now);
    return {
      id: user.id,
      room_id: roomId,
      nickname: user.nickname,
      muted: 0,
      sharing_screen: 0,
      join_time: now,
    };
  }

  removeUser(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  setMuted(userId: string, muted: boolean): void {
    this.db.prepare('UPDATE users SET muted = ? WHERE id = ?').run(muted ? 1 : 0, userId);
  }

  setSharingScreen(userId: string, sharing: boolean): void {
    this.db
      .prepare('UPDATE users SET sharing_screen = ? WHERE id = ?')
      .run(sharing ? 1 : 0, userId);
  }

  getUsers(roomId: string): UserRow[] {
    return this.db.prepare('SELECT * FROM users WHERE room_id = ?').get(roomId)
      ? (this.db.prepare('SELECT * FROM users WHERE room_id = ?').all(roomId) as UserRow[])
      : [];
  }

  private generateRoomId(): string {
    // Gera um id de 6 caracteres em [A-Z0-9], sem ambiguidades visuais.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    do {
      id = Array.from(
        { length: 6 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join('');
    } while (this.getRoom(id) || !isRoomId(id));
    return id;
  }
}
