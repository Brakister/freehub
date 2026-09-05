import express from 'express';
import cors from 'cors';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { SERVER_PORT } from '@discord3/shared';
import { DatabaseStore } from './db';
import { registerSocketHandlers, RoomManager } from './rooms';

const dbPath = process.env.DB_PATH ?? `${process.cwd()}/data/discord3.db`;
mkdirSync(dirname(dbPath), { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'Discord3 server' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const db = new DatabaseStore(dbPath);
const manager = new RoomManager(db, io);
registerSocketHandlers(io, manager);

const port = Number(process.env.PORT ?? SERVER_PORT);
httpServer.listen(port, () => {
  console.log(`[server] Discord3 rodando em http://localhost:${port}`);
});
