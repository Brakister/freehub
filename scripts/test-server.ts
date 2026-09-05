import { io } from 'socket.io-client';
import {
  ClientEvent,
  ServerEvent,
  isRoomId,
  isValidNickname,
  isValidRoomName,
} from '@discord3/shared';

const URL = 'http://localhost:3001';

function waitFor(socket: ReturnType<typeof io>, event: string, timeoutMs = 3000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload: unknown): void => {
      clearTimeout(t);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function main(): Promise<void> {
  console.log(
    '[test] building shared:',
    isValidNickname('ana'),
    isRoomId('ABC123'),
    isValidRoomName('sala'),
  );

  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });
  await Promise.all([
    new Promise((r) => a.on('connect', r)),
    new Promise((r) => b.on('connect', r)),
  ]);
  console.log('[test] clients connected');

  const created = (await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout room:created')), 3000);
    a.on(ServerEvent.roomCreated, (p) => {
      clearTimeout(t);
      resolve(p);
    });
    a.emit(ClientEvent.createRoom, { nickname: 'Ana', roomName: 'Sala da Ana' });
  })) as { room: { id: string; name: string } };
  console.log('[test] room created:', created);

  const joinedPayload = waitFor(b, ServerEvent.roomJoined);
  const userJoined = waitFor(a, ServerEvent.userJoined);
  b.emit(ClientEvent.joinRoom, { roomId: created.room.id, nickname: 'Bia' });
  const joined = (await joinedPayload) as { room: unknown; users: unknown[] };
  const joinedUser = (await userJoined) as { nickname: string };
  console.log(
    '[test] Bia joined, room users:',
    joined.users.length,
    'A sees:',
    joinedUser.nickname,
  );

  const muted = waitFor(b, ServerEvent.userMuted);
  a.emit(ClientEvent.toggleMute, true);
  console.log('[test] mute:', await muted);

  const relay = waitFor(b, ServerEvent.signaling);
  a.emit(ClientEvent.signaling, {
    targetUserId: (joined.users[1] as { id: string }).id,
    signal: { sdp: 'fake-offer' },
  });
  console.log('[test] relayed sig:', await relay);

  const screenShared = waitFor(b, ServerEvent.screenShared);
  a.emit(ClientEvent.startScreenShare);
  const shared = (await screenShared) as { userId: string };
  const ownerId = (created as { selfId: string }).selfId;
  if (shared.userId !== ownerId) throw new Error('screen:shared deveria vir do owner A');
  console.log('[test] screen shared by:', shared.userId === ownerId ? 'ok' : shared.userId);

  const screenStopped = waitFor(b, ServerEvent.screenStopped);
  a.emit(ClientEvent.stopScreenShare);
  console.log('[test] screen stopped:', await screenStopped);

  // Sala não encontrada (cliente dedicado, não perturba a sala de A/B)
  const c = io(URL, { transports: ['websocket'] });
  await new Promise((r) => c.on('connect', r));
  const notFound = waitFor(c, ServerEvent.roomNotFound);
  c.emit(ClientEvent.joinRoom, { roomId: 'ZZZZZZ', nickname: 'X' });
  console.log('[test] room not found:', (await notFound) as { message: string });
  c.disconnect();

  // Sala cheia (máx 6): criador + 5 = cheia; o 7º recebe room:full
  const d = io(URL, { transports: ['websocket'] });
  await new Promise((r) => d.on('connect', r));
  const fullRoom = await new Promise<{ room: { id: string } }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout room:created')), 3000);
    d.on(ServerEvent.roomCreated, (p) => {
      clearTimeout(t);
      resolve(p as { room: { id: string } });
    });
    d.emit(ClientEvent.createRoom, { nickname: 'Dan', roomName: 'Cheia' });
  });
  const joiners: ReturnType<typeof io>[] = [];
  for (let i = 0; i < 5; i++) {
    const joiner = io(URL, { transports: ['websocket'] });
    await new Promise((r) => joiner.on('connect', r));
    joiners.push(joiner);
    joiner.emit(ClientEvent.joinRoom, { roomId: fullRoom.room.id, nickname: `J${i}` });
  }
  const overflow = io(URL, { transports: ['websocket'] });
  await new Promise((r) => overflow.on('connect', r));
  const roomFull = waitFor(overflow, ServerEvent.roomFull);
  overflow.emit(ClientEvent.joinRoom, { roomId: fullRoom.room.id, nickname: 'Lota' });
  console.log('[test] room full:', (await roomFull) as { message: string });
  overflow.disconnect();
  joiners.forEach((j) => j.disconnect());
  d.disconnect();

  const left = waitFor(b, ServerEvent.userLeft);
  a.emit(ClientEvent.leaveRoom);
  console.log('[test] A left, B sees:', await left);

  a.disconnect();
  b.disconnect();
  console.log('[test] OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('[test] FAILED:', e.message);
  process.exit(1);
});
