import { useState, type FormEvent } from 'react';
import { isRoomId, isValidRoomName, normalizeNickname } from '@freehub/shared';

export interface SidebarRoom {
  id: string;
  name: string;
}

interface SidebarProps {
  nickname: string;
  room: SidebarRoom | null;
  onCreateRoom(roomName: string): void;
  onJoinRoom(roomId: string): void;
  onLeaveRoom(): void;
  onOpenSettings(): void;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const handleCreate = (e: FormEvent): void => {
    e.preventDefault();
    setError('');
    const name = normalizeNickname(roomName || 'Sala da ' + props.nickname);
    if (!isValidRoomName(name)) {
      setError('Nome da sala deve ter entre 1 e 48 caracteres.');
      return;
    }
    props.onCreateRoom(name);
    setRoomName('');
  };

  const handleJoin = (e: FormEvent): void => {
    e.preventDefault();
    setError('');
    const code = roomCode.trim().toUpperCase();
    if (!isRoomId(code)) {
      setError('Código inválido. Use o formato de 6 letras/números.');
      return;
    }
    props.onJoinRoom(code);
    setRoomCode('');
  };

  return (
    <aside className="flex h-full w-64 flex-col bg-[#1e1f22] text-[#dbdee1]">
      <div className="border-b border-black/30 px-4 py-3">
        <div className="text-sm font-bold tracking-wide">Freehub</div>
        <div className="truncate text-xs text-[#949ba4]" title={props.nickname}>
          {props.nickname}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.room ? (
          <div className="mb-3 rounded bg-[#2b2d31] p-3">
            <div className="text-xs font-semibold text-[#b5bac1]">Sala atual</div>
            <div className="truncate text-sm font-medium">{props.room.name}</div>
            <div className="font-mono text-xs text-[#5865f2]">#{props.room.id}</div>
          </div>
        ) : (
          <div className="mb-3 rounded bg-[#2b2d31] p-3 text-xs text-[#949ba4]">
            Você não está em nenhuma sala.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded bg-[#3a1d1d] px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        <form onSubmit={(e) => void handleCreate(e)} className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-[#949ba4]">Criar sala</label>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Nome da sala"
            maxLength={48}
            className="mb-2 w-full rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none ring-offset-2 transition focus:ring-2 focus:ring-[#5865f2]"
          />
          <button
            type="submit"
            className="w-full rounded bg-[#5865f2] px-3 py-2 text-sm font-medium transition hover:bg-[#4752c4] disabled:opacity-40"
            disabled={props.room !== null}
          >
            Criar sala
          </button>
        </form>

        <form onSubmit={(e) => void handleJoin(e)} className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-[#949ba4]">
            Entrar com código
          </label>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="ABC123"
            maxLength={6}
            className="mb-2 w-full rounded bg-[#1e1f22] px-3 py-2 font-mono text-sm uppercase outline-none transition focus:ring-2 focus:ring-[#5865f2]"
          />
          <button
            type="submit"
            className="w-full rounded bg-[#23a559] px-3 py-2 text-sm font-medium transition hover:bg-[#1e8c4c] disabled:opacity-40"
            disabled={props.room !== null}
          >
            Entrar na sala
          </button>
        </form>

        <button
          onClick={props.onLeaveRoom}
          disabled={props.room === null}
          className="w-full rounded border border-[#3a3d41] px-3 py-2 text-sm font-medium text-[#b5bac1] transition hover:bg-[#2b2d31] disabled:opacity-40"
        >
          Sair da sala
        </button>
      </div>

      <div className="border-t border-black/30 p-3">
        <button
          onClick={props.onOpenSettings}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm transition hover:bg-[#2b2d31]"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Configurações
        </button>
      </div>
    </aside>
  );
}
