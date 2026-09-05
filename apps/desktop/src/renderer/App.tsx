import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClientEvent, ServerEvent, SCREEN_QUALITIES, DEFAULT_SCREEN_QUALITY_ID, type RoomState, type User } from '@freehub/shared';
import { SettingsModal, Sidebar, VoicePanel, type VoiceUserView, useSettings } from '@freehub/ui';
import { getSocket } from './net/socket';
import { useConnectionStore, type RoomInfo } from './stores/useConnectionStore';
import { VoiceSession } from './voice/session';
import { applyOutputToElements, registerAudioElement } from './voice/output';
import { UpdateBanner } from './components/UpdateBanner';

function ConnectionBanner({ status }: { status: string }): React.JSX.Element {
  const map: Record<string, string> = {
    connecting: 'Conectando ao servidor…',
    reconnecting: 'Reconectando…',
    disconnected: 'Desconectado do servidor.',
  };
  const text = map[status] ?? null;
  if (!text) return <></>;
  return (
    <div className="bg-amber-500/20 px-4 py-1.5 text-center text-xs font-medium text-amber-300">
      {text}
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between bg-red-500/20 px-4 py-1.5 text-xs font-medium text-red-300">
      <span>{message}</span>
      <button onClick={onDismiss} className="rounded px-2 hover:bg-red-500/30">
        ×
      </button>
    </div>
  );
}

function EmptyState({ connected }: { connected: boolean }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[#b5bac1]">
      <div className="text-5xl">🔊</div>
      <div className="text-lg font-semibold text-white">Voz clara, sem complicação</div>
      <p className="max-w-sm text-center text-sm">
        {connected
          ? 'Crie uma sala pelo menu à esquerda ou entre com o código de 6 caracteres de uma amigue.'
          : 'Conectando ao servidor de voz…'}
      </p>
    </div>
  );
}

function RemoteAudio({
  userId,
  getStream,
}: {
  userId: string;
  getStream(userId: string): MediaStream | null;
}): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unregister = registerAudioElement(el);
    el.autoplay = true;
    // O stream só existe depois do WebRTC conectar; verifica até aparecer.
    const apply = (): void => {
      const stream = getStream(userId);
      if (stream && el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => undefined);
      }
    };
    apply();
    const timer = setInterval(apply, 500);
    return () => {
      clearInterval(timer);
      el.srcObject = null;
      unregister();
    };
  }, [userId, getStream]);
  return <audio ref={ref} style={{ display: 'none' }} />;
}

function ScreenShareCard({
  getStream,
  title,
  showStop,
  onStop,
}: {
  getStream: () => MediaStream | null;
  title: string;
  showStop: boolean;
  onStop?: () => void;
}): React.JSX.Element | null {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  useEffect(() => {
    const apply = (): void => {
      const stream = getStream();
      const el = ref.current;
      if (stream && el && el.srcObject !== stream) el.srcObject = stream;
      setHasStream(Boolean(stream));
    };
    apply();
    const timer = setInterval(apply, 500);
    return () => clearInterval(timer);
  }, [getStream]);
  if (!hasStream) return null;
  return (
    <div className="absolute bottom-20 right-6 z-20 w-80 overflow-hidden rounded-xl border-2 border-[#5865f2] bg-black shadow-2xl">
      <video ref={ref} autoPlay muted playsInline className="aspect-video w-full bg-black" />
      <div className="flex items-center justify-between gap-2 bg-[#1e1f22]/95 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-white">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="truncate">{title}</span>
        </div>
        {showStop && onStop && (
          <button
            onClick={onStop}
            className="shrink-0 rounded bg-[#d83c3e] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#b83234]"
          >
            Parar
          </button>
        )}
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  const {
    status,
    connected,
    selfId,
    room,
    users,
    speaking,
    muted,
    screenshare,
    error,
    settingsOpen,
  } = useConnectionStore();
  const nickname = useSettings((s) => s.nickname);
  const inputDeviceId = useSettings((s) => s.inputDeviceId);
  const micGain = useSettings((s) => s.micGain);
  const speakerVolume = useSettings((s) => s.speakerVolume);
  const outputDeviceId = useSettings((s) => s.outputDeviceId);
  const serverUrl = useSettings((s) => s.serverUrl);
  const screenQualityId = useSettings((s) => s.screenQualityId);

  const sessionRef = useRef<VoiceSession | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const ensureSession = useCallback(async (deviceId: string): Promise<VoiceSession> => {
    if (sessionRef.current) {
      if (sessionRef.current.inputDeviceId === deviceId) return sessionRef.current;
      await sessionRef.current.dispose();
      sessionRef.current = null;
    }
    const session = new VoiceSession(deviceId);
    await session.init();
    sessionRef.current = session;
    return session;
  }, []);

  const handleCreateRoom = async (roomName: string): Promise<void> => {
    try {
      await ensureSession(inputDeviceId);
      setMicError(null);
      useConnectionStore.getState().createRoom(roomName, nickname);
    } catch {
      setMicError('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const handleJoinRoom = async (roomId: string): Promise<void> => {
    try {
      await ensureSession(inputDeviceId);
      setMicError(null);
      useConnectionStore.getState().joinRoom(roomId, nickname);
    } catch {
      setMicError('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const handleLeaveRoom = (): void => {
    void sessionRef.current?.dispose();
    sessionRef.current = null;
    useConnectionStore.getState().leaveRoom();
  };

  const handleToggleScreenShare = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (screenshare?.userId === selfId) {
      await session.unpublishScreenShare();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      getSocket().emit(ClientEvent.stopScreenShare);
    } else {
      try {
        const quality =
          SCREEN_QUALITIES.find((q) => q.id === screenQualityId) ??
          SCREEN_QUALITIES.find((q) => q.id === DEFAULT_SCREEN_QUALITY_ID) ??
          SCREEN_QUALITIES[0];
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: quality.width },
            height: { ideal: quality.height },
            frameRate: { ideal: quality.frameRate },
          },
          audio: true,
        });
        await session.publishScreenShare(stream);
        screenStreamRef.current = stream;
        setShareError(null);
        getSocket().emit(ClientEvent.startScreenShare);
      } catch (err) {
        // Usuário cancelou a seleção de tela ou houve falha de captura.
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'AbortError') {
          setShareError(null);
        } else {
          console.error('[share] falha ao capturar tela:', err);
          setShareError('Não foi possível compartilhar a tela. Tente novamente.');
        }
      }
    }
  };

  // ---- listeners de socket (uma vez por URL de servidor) ----
  useEffect(() => {
    // Troca de servidor: limpa estado local e sessão de voz para reconectar limpo.
    useConnectionStore.getState().reset();
    void sessionRef.current?.dispose();
    sessionRef.current = null;

    const socket = getSocket();
    type Payload = unknown;
    type Handler = (payload: Payload) => void;

    const onConnect = (): void => {
      console.log('[app] conectado ao servidor de voz');
      useConnectionStore.getState().markConnected(true, 'connected');
    };
    const onDisconnect = (): void => {
      console.log('[app] desconectado do servidor');
      useConnectionStore.getState().markConnected(false, 'disconnected');
    };
    const onReconnectAttempt = (): void =>
      useConnectionStore.getState().markConnected(false, 'reconnecting');
    const onConnectError = (): void =>
      useConnectionStore.getState().setError('Falha ao conectar ao servidor de voz.');

    const onRoomCreated = (p: Payload): void => {
      const { room, selfId } = p as { room: RoomInfo; selfId: string };
      useConnectionStore.getState().applyRoomCreated(selfId, room, useSettings.getState().nickname);
    };
    const onRoomJoined = (p: Payload): void => {
      const payload = p as RoomState & { selfId: string };
      useConnectionStore.getState().applyRoomJoined(payload);
      sessionRef.current?.onJoinedRoom(payload.users, payload.selfId);
    };
    const onUserJoined = (p: Payload): void => {
      useConnectionStore.getState().addUser(p as User);
    };
    const onUserLeft = (p: Payload): void => {
      const userId = (p as { userId: string }).userId;
      useConnectionStore.getState().removeUser(userId);
      sessionRef.current?.onPeerLeft(userId);
    };
    const onUserMuted = (p: Payload): void => {
      const payload = p as { userId: string; muted: boolean };
      useConnectionStore.getState().updateUserMuted(payload.userId, payload.muted);
    };
    const onScreenShared = (p: Payload): void => {
      const { userId } = p as { userId: string };
      useConnectionStore.getState().setScreenshare({ userId, startedAt: Date.now() });
    };
    const onScreenStopped = (): void => useConnectionStore.getState().setScreenshare(null);
    const onSignaling = (p: Payload): void => {
      const payload = p as { targetUserId: string; signal: unknown };
      sessionRef.current?.onSignal(payload.targetUserId, payload.signal);
    };
    const onRoomError =
      (prefix: string) =>
      (p: Payload): void => {
        const message = (p as { message?: string } | undefined)?.message;
        useConnectionStore.getState().setError(message ?? prefix);
      };

    const plain: Array<[string, () => void]> = [
      ['connect', onConnect],
      ['disconnect', onDisconnect],
      ['reconnect_attempt', onReconnectAttempt],
      ['connect_error', onConnectError],
    ];
    const payloadHandlers: Array<[string, Handler]> = [
      [ServerEvent.roomCreated, onRoomCreated],
      [ServerEvent.roomJoined, onRoomJoined],
      [ServerEvent.userJoined, onUserJoined],
      [ServerEvent.userLeft, onUserLeft],
      [ServerEvent.userMuted, onUserMuted],
      [ServerEvent.screenShared, onScreenShared],
      [ServerEvent.screenStopped, onScreenStopped],
      [ServerEvent.signaling, onSignaling],
      [ServerEvent.error, onRoomError('Erro do servidor.')],
      [ServerEvent.roomNotFound, onRoomError('Sala não encontrada.')],
      [ServerEvent.roomFull, onRoomError('Sala cheia.')],
    ];

    const listeners: Array<[string, (payload?: unknown) => void]> = [...plain, ...payloadHandlers];
    for (const [event, handler] of listeners)
      socket.on(event, handler as (payload?: unknown) => void);
    socket.connect();

    return () => {
      for (const [event, handler] of listeners)
        socket.off(event, handler as (payload?: unknown) => void);
      socket.disconnect();
    };
  }, [serverUrl]);

  // ---- mute local ----
  useEffect(
    () =>
      useConnectionStore.subscribe((s, prev) => {
        if (s.muted !== prev.muted) sessionRef.current?.setMuted(s.muted);
      }),
    [],
  );

  // ---- watchers de settings ----
  useEffect(() => {
    sessionRef.current?.applyMicGain(micGain);
  }, [micGain]);
  useEffect(() => {
    sessionRef.current?.applySpeakerVolume(speakerVolume);
  }, [speakerVolume]);
  useEffect(() => {
    applyOutputToElements(outputDeviceId);
  }, [outputDeviceId]);

  const prevInputRef = useRef(inputDeviceId);
  useEffect(() => {
    const prev = prevInputRef.current;
    prevInputRef.current = inputDeviceId;
    if (prev === inputDeviceId) return;
    void (async () => {
      try {
        const session = await ensureSession(inputDeviceId);
        session.applyMicGain(micGain);
        session.applySpeakerVolume(speakerVolume);
        const st = useConnectionStore.getState();
        if (st.room && st.selfId) session.onJoinedRoom(st.users, st.selfId);
      } catch {
        setMicError('Não foi possível acessar o novo microfone.');
      }
    })();
  }, [inputDeviceId, ensureSession, micGain, speakerVolume]);

  const voiceUsers: VoiceUserView[] = useMemo(
    () => users.map((u) => ({ ...u, speaking: speaking[u.id] ?? false, isSelf: u.id === selfId })),
    [users, speaking, selfId],
  );

  const getStream = useCallback(
    (userId: string) => sessionRef.current?.getRemoteStream(userId) ?? null,
    [],
  );

  const isScreenSharing = screenshare?.userId === selfId;

  return (
    <div className="flex h-full w-full">
      <Sidebar
        nickname={nickname}
        room={room}
        onCreateRoom={(name) => void handleCreateRoom(name)}
        onJoinRoom={(id) => void handleJoinRoom(id)}
        onLeaveRoom={handleLeaveRoom}
        onOpenSettings={() => useConnectionStore.getState().openSettings()}
      />

      <div className="flex flex-1 flex-col">
        <ConnectionBanner status={connected ? 'connected' : status} />
        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => useConnectionStore.getState().setError(null)}
          />
        )}
        {micError && <ErrorBanner message={micError} onDismiss={() => setMicError(null)} />}
        {shareError && <ErrorBanner message={shareError} onDismiss={() => setShareError(null)} />}

        {room ? (
          <div className="relative flex-1">
            <VoicePanel
              roomName={room.name}
              users={voiceUsers}
              muted={muted}
              sharingScreen={isScreenSharing}
              onToggleMute={() => useConnectionStore.getState().toggleMute()}
              onToggleScreenShare={() => void handleToggleScreenShare()}
              onLeaveRoom={handleLeaveRoom}
            />
            {screenshare &&
              (screenshare.userId === selfId ? (
                <ScreenShareCard
                  getStream={() => screenStreamRef.current}
                  title="Você está transmitindo"
                  showStop
                  onStop={() => void handleToggleScreenShare()}
                />
              ) : (
                <ScreenShareCard
                  getStream={() => getStream(screenshare.userId)}
                  title={
                    (users.find((u) => u.id === screenshare.userId)?.nickname ?? 'Alguém') +
                    ' está transmitindo'
                  }
                  showStop={false}
                />
              ))}
            {users
              .filter((u) => u.id !== selfId)
              .map((u) => (
                <RemoteAudio key={u.id} userId={u.id} getStream={getStream} />
              ))}
          </div>
        ) : (
          <>
            <EmptyState connected={connected} />
            <UpdateBanner />
          </>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => useConnectionStore.getState().closeSettings()}
      />
    </div>
  );
}
