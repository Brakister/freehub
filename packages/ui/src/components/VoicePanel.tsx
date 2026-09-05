import { useState } from 'react';
import type { User } from '@freehub/shared';

export interface VoiceUserView extends User {
  speaking: boolean;
  isSelf: boolean;
}

interface VoicePanelProps {
  roomName: string;
  users: VoiceUserView[];
  muted: boolean;
  sharingScreen: boolean;
  onToggleMute(): void;
  onToggleScreenShare(): void;
  onLeaveRoom(): void;
  userVolumes: Record<string, number>;
  onUserVolumeChange(userId: string, volume: number): void;
}

export function SpeakingIndicator({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span
      data-testid="speaking-indicator"
      aria-label={active ? 'Falando' : 'Silencioso'}
      className={`inline-block h-2 w-2 rounded-full transition ${
        active ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]' : 'bg-[#80848e]'
      }`}
    />
  );
}

function Avatar({
  nickname,
  speaking,
  muted,
}: {
  nickname: string;
  speaking: boolean;
  muted: boolean;
}): React.JSX.Element {
  const ring = speaking
    ? 'ring-2 ring-green-400 shadow-[0_0_14px_rgba(74,222,128,0.8)]'
    : 'ring-2 ring-[#3a3d41]';
  return (
    <div className={`relative mx-auto h-20 w-20 ${ring} rounded-full bg-[#5865f2] transition`}>
      <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white">
        {nickname.charAt(0).toUpperCase()}
      </div>
      {muted && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-[#1e1f22] p-1" title="Mutado">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-red-400"
          >
            <path
              d="M16.9 14.9A6 6 0 0 0 18 11V8a6 6 0 0 0-12 0v3a6 6 0 0 0 .1 1l.7-.7A5 5 0 0 1 6 11V8a4 4 0 0 1 7.9-.1l-2.5 2.5A4 4 0 0 0 10 11v3a2 2 0 0 0 .6 1.4L9 17a5 5 0 0 1-1-3V11h-2v3a5 5 0 0 0 5 5h2v-2h-2a3 3 0 0 1-3-3v-1h2v1a1 1 0 0 0 1 1Z"
              fillOpacity="0.4"
            />
            <path d="m2 2 20 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

export function VoiceParticipantTile(
  props: VoiceUserView & {
    volume?: number;
    onVolumeChange?: (userId: string, volume: number) => void;
  },
): React.JSX.Element {
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const volume = props.volume ?? 1;
  return (
    <div
      data-testid="voice-participant"
      className={`relative flex flex-col items-center rounded-lg bg-[#2b2d31] px-4 py-4 transition ${
        props.speaking ? 'bg-[#283032]' : ''
      }`}
    >
      <Avatar nickname={props.nickname} speaking={props.speaking} muted={props.muted} />
      <div className="mt-3 flex w-full items-center justify-center gap-2 text-sm font-medium text-[#dbdee1]">
        <SpeakingIndicator active={props.speaking} />
        <span className="max-w-[120px] truncate">{props.nickname}</span>
        {props.sharingScreen && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-green-400"
          >
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <path d="m8 21 4-4 4 4" />
          </svg>
        )}
        {!props.isSelf && props.onVolumeChange && (
          <button
            type="button"
            onClick={() => setVolumeMenuOpen((open) => !open)}
            title="Volume individual"
            aria-label={`Volume de ${props.nickname}`}
            className="ml-1 text-[#b5bac1] transition hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 9v6h4l5 4V5L8 9H4Z" />
              <path d="M17 9.5a4 4 0 0 1 0 5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {!props.isSelf && props.onVolumeChange && volumeMenuOpen && (
        <div className="mt-2 flex w-full items-center gap-2 rounded bg-[#1e1f22] px-2 py-1.5">
          <span className="text-[10px] text-[#b5bac1]">0</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => props.onVolumeChange?.(props.id, Number(event.target.value))}
            aria-label={`Volume de ${props.nickname}`}
            className="min-w-0 flex-1 accent-[#5865f2]"
          />
          <span className="w-7 text-right text-[10px] text-[#b5bac1]">{Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export function VoicePanel(props: VoicePanelProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-[#313338]">
      <header className="flex items-center justify-between border-b border-black/30 px-6 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-[#949ba4]"
          >
            <path d="M5 3 3 5l2 2-2 2 4 1V4L5 3Z" />
            <path d="m8.5 5.5 12 12" strokeLinecap="round" />
            <path d="M3 12v3h3" strokeLinecap="round" />
            <path d="M12 2a4 4 0 0 1 3 1.6" strokeLinecap="round" />
            <path d="M12 6v4" strokeLinecap="round" />
          </svg>
          <span className="text-lg font-semibold text-white">{props.roomName}</span>
        </div>
        <div className="text-sm text-[#949ba4]">{props.users.length} no canal</div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {props.users.map((u) => (
            <VoiceParticipantTile
              key={u.id}
              {...u}
              volume={props.userVolumes[u.id] ?? 1}
              onVolumeChange={props.onUserVolumeChange}
            />
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-center gap-3 border-t border-black/30 px-6 py-4">
        <button
          onClick={props.onToggleMute}
          data-testid="mute-button"
          title={props.muted ? 'Ativar microfone' : 'Mutado'}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
            props.muted
              ? 'bg-[#3a3d41] text-[#b5bac1] hover:bg-[#4a4d51]'
              : 'bg-[#23a559] text-white hover:bg-[#1e8c4c]'
          }`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="3" width="6" height="11" rx="2.5" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </button>

        <button
          onClick={props.onToggleScreenShare}
          data-testid="screen-button"
          title={props.sharingScreen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
            props.sharingScreen
              ? 'bg-green-500 text-white'
              : 'bg-[#3a3d41] text-[#b5bac1] hover:bg-[#4a4d51]'
          }`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="m10 15 5-3-5-3v6Z" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          onClick={props.onLeaveRoom}
          data-testid="leave-button"
          title="Sair"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#3a3d41] text-[#b5bac1] transition hover:bg-[#d83c3e] hover:text-white"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10 17l5-5-5-5" />
            <path d="M15 12H3" />
            <path d="M14 3h6v18h-6" />
          </svg>
        </button>
      </footer>
    </div>
  );
}
