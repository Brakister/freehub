import { ICE_SERVERS } from '@freehub/shared';
import { VoiceActivityDetector } from './vad';

type Signal = { type?: string; sdp?: string; candidate?: RTCIceCandidateInit };

export interface PeerCallbacks {
  /** Envia um sinal (offer/answer/ice) para o usuário remoto via servidor. */
  sendSignal(targetUserId: string, signal: unknown): void;
  /** Notifica quando o nível de fala de um peer muda. */
  onSpeakingChange?(userId: string, speaking: boolean, level: number): void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  voiceStream: MediaStream;
  screenStream: MediaStream;
  screenTracks: Set<MediaStreamTrack>;
  stopDetector: () => void;
  voiceDetectorStarted: boolean;
  negotiating: boolean;
  pendingRenegotiation: boolean;
  /** A oferta inicial já reservou as m-lines de vídeo/som da tela. */
  screenLinesReserved: boolean;
}

/**
 * Gerencia conexões WebRTC em malha (mesh). Encapsula signaling, mídia
 * local e detecção de fala por peer remoto.
 */
export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  constructor(private callbacks: PeerCallbacks) {}

  /** Define o stream de microfone local (deve ser chamado antes de createPeer). */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Ajuda o Opus a tratar a trilha como fala (FEC/DTX e menos bitrate).
    for (const track of stream.getAudioTracks()) {
      if (!track.contentHint) track.contentHint = 'speech';
    }
  }

  /** Define o stream de tela para que novos peers recebam as tracks automaticamente. */
  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
  }

  /** Cria (ou retorna) a conexão com um peer, já anexando o stream local. */
  ensurePeer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const voiceStream = new MediaStream();
    const screenStream = new MediaStream();
    const entry: PeerEntry = {
      pc,
      voiceStream,
      screenStream,
      screenTracks: new Set<MediaStreamTrack>(),
      stopDetector: () => undefined,
      voiceDetectorStarted: false,
      negotiating: false,
      pendingRenegotiation: false,
      screenLinesReserved: false,
    };
    this.peers.set(userId, entry);

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        entry.screenTracks.add(track);
        pc.addTrack(track, this.screenStream);
      }
    }
    // Reaplica os limites em todos os peers: com mais gente na sala, o video
    // de cada conexao precisa ceder CPU/banda para a voz.
    this.reconfigureAllMediaPriorities();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.callbacks.sendSignal(userId, { type: 'ice-candidate', candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const isScreen = (e.streams[0]?.getVideoTracks().length ?? 0) > 0;
      if (e.track.kind === 'audio') {
        if (isScreen) {
          for (const t of screenStream.getAudioTracks()) screenStream.removeTrack(t);
          if (!screenStream.getTracks().includes(e.track)) screenStream.addTrack(e.track);
        } else if (!voiceStream.getTracks().includes(e.track)) {
          voiceStream.addTrack(e.track);
          if (!entry.voiceDetectorStarted) {
            entry.voiceDetectorStarted = true;
            const detector = new VoiceActivityDetector(voiceStream, { threshold: 0.008 });
            detector.onChange((speaking, level) =>
              this.callbacks.onSpeakingChange?.(userId, speaking, level),
            );
            entry.stopDetector = detector.start();
          }
        }
      } else {
        for (const t of screenStream.getVideoTracks()) {
          if (t !== e.track) screenStream.removeTrack(t);
        }
        if (!screenStream.getTracks().includes(e.track)) screenStream.addTrack(e.track);
        e.track.addEventListener(
          'ended',
          () => {
            if (screenStream.getTracks().includes(e.track)) screenStream.removeTrack(e.track);
          },
          { once: true },
        );
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(userId);
      }
    };

    return pc;
  }

  /** Processa signaling recebido (offer/answer/ice-candidate). */
  async handleIncomingSignal(userId: string, signal: unknown): Promise<void> {
    const s = signal as Signal;
    const pc = this.ensurePeer(userId);

    if (s.type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.callbacks.sendSignal(userId, { type: 'answer', sdp: answer.sdp });
    } else if (s.type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      }
    } else if (s.type === 'ice-candidate' && s.candidate) {
      await pc.addIceCandidate(s.candidate).catch(() => undefined);
    }
  }

  /** Inicia a negociação criando uma oferta para o peer. */
  async call(userId: string): Promise<void> {
    const pc = this.ensurePeer(userId);
    const entry = this.peers.get(userId);
    if (!entry) return;
    try {
      this.reserveScreenMediaLines(pc, entry);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.callbacks.sendSignal(userId, { type: 'offer', sdp: offer.sdp });
    } catch (err) {
      console.error('[peer] failed to create offer:', err);
    }
  }

  /**
   * Reserva, na primeira oferta, as m-lines de vídeo e de som da tela.
   *
   * Sem isso, quem entra numa sala onde já existe transmissão oferece apenas
   * o microfone. O WebRTC não deixa a resposta criar m-lines novas, então o
   * sharer não tem onde colocar o vídeo/áudio da tela e o recém-chegado fica
   * com a tela preta até uma renegociação. Reservar as m-lines desde o início
   * faz a tela chegar junto com a conexão, sem botão de "assistir".
   *
   * A primeira m-line de áudio pertence à voz; a segunda fica para o áudio
   * da tela. O vídeo tem a sua própria m-line.
   */
  private reserveScreenMediaLines(pc: RTCPeerConnection, entry: PeerEntry): void {
    if (entry.screenLinesReserved) return;
    const transceivers = pc.getTransceivers();
    const hasVideo = transceivers.some((t) => t.receiver.track.kind === 'video');
    const audioCount = transceivers.filter(
      (t) => t.receiver.track.kind === 'audio',
    ).length;

    if (!hasVideo) pc.addTransceiver('video', { direction: 'recvonly' });
    for (let i = audioCount; i < 2; i += 1) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    entry.screenLinesReserved = true;
  }

  /**
   * Publica as trilhas de vídeo e áudio da tela (screen share) para todos os
   * peers e renegocia. O áudio do display envia o som do sistema; o áudio de
   * voz dos demais continua tocando normalmente.
   */
  async publishScreenTrack(stream: MediaStream): Promise<void> {
    this.screenStream = stream;
    for (const entry of this.peers.values()) {
      for (const track of stream.getTracks()) {
        if (entry.screenTracks.has(track)) continue;
        entry.screenTracks.add(track);
        entry.pc.addTrack(track, stream);
      }
      // Se a track caiu numa m-line reservada como recvonly, libera o envio.
      for (const transceiver of entry.pc.getTransceivers()) {
        const track = transceiver.sender.track;
        if (!track || !entry.screenTracks.has(track)) continue;
        if (
          transceiver.direction === 'recvonly' ||
          transceiver.direction === 'inactive'
        ) {
          transceiver.direction = 'sendrecv';
        }
      }
      this.configureMediaPriorities(entry.pc, entry.screenTracks);
    }
    for (const [userId, entry] of this.peers) {
      if (!entry.negotiating) {
        entry.negotiating = true;
        void this.call(userId).finally(() => {
          entry.negotiating = false;
          if (entry.pendingRenegotiation) {
            entry.pendingRenegotiation = false;
            void this.call(userId);
          }
        });
      } else {
        entry.pendingRenegotiation = true;
      }
    }
  }

  /** Remove apenas as trilhas de screen share e renegocia (voz permanece). */
  async unpublishScreenTrack(): Promise<void> {
    this.screenStream = null;
    for (const entry of this.peers.values()) {
      for (const sender of entry.pc.getSenders()) {
        if (sender.track && entry.screenTracks.has(sender.track)) {
          entry.pc.removeTrack(sender);
        }
      }
      entry.screenTracks.clear();
    }
    for (const [userId, entry] of this.peers) {
      if (!entry.negotiating) {
        entry.negotiating = true;
        void this.call(userId).finally(() => {
          entry.negotiating = false;
          if (entry.pendingRenegotiation) {
            entry.pendingRenegotiation = false;
            void this.call(userId);
          }
        });
      } else {
        entry.pendingRenegotiation = true;
      }
    }
  }

  /** Retorna o stream de VOZ de um peer (apenas o microfone). */
  getVoiceStream(userId: string): MediaStream | null {
    return this.peers.get(userId)?.voiceStream ?? null;
  }

  /** Retorna o stream de TELA de um peer (vídeo + som do sistema/screen). */
  getScreenStream(userId: string): MediaStream | null {
    return this.peers.get(userId)?.screenStream ?? null;
  }

  getPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  private reconfigureAllMediaPriorities(): void {
    for (const entry of this.peers.values()) {
      this.configureMediaPriorities(entry.pc, entry.screenTracks);
    }
  }

  private configureMediaPriorities(
    pc: RTCPeerConnection,
    screenTracks: Set<MediaStreamTrack>,
  ): void {
    const peerCount = this.peers.size;
    // Em malha, cada peer recebe uma copia do video. A partir de dois
    // espectadores, 30 FPS ja basta e evita que o encoder de video sufoque
    // o audio; com tres ou mais, limita a largura para 1280 px.
    const capFrameRate = peerCount >= 2 ? 30 : undefined;
    const maxWidth = peerCount >= 3 ? 1280 : undefined;

    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      const parameters = sender.getParameters();
      const encoding = parameters.encodings?.[0] ?? {};

      if (sender.track.kind === 'audio') {
        // Voz e som do sistema vao com prioridade alta; o teto de bitrate
        // impede que o som da tela dispute banda com o microfone.
        encoding.priority = 'high';
        encoding.networkPriority = 'high';
        encoding.maxBitrate = screenTracks.has(sender.track) ? 128_000 : 64_000;
      } else if (sender.track.kind === 'video') {
        const settings = sender.track.getSettings();
        const width = settings.width ?? 1920;
        const height = settings.height ?? 1080;
        const sourceFps =
          settings.frameRate && settings.frameRate > 0 ? settings.frameRate : 30;
        const targetFps = capFrameRate ? Math.min(sourceFps, capFrameRate) : sourceFps;

        encoding.priority = 'low';
        encoding.networkPriority = 'low';
        encoding.maxBitrate = Math.min(
          2_500_000,
          Math.max(800_000, Math.round(width * height * targetFps * 0.05)),
        );

        if (capFrameRate && sourceFps > capFrameRate) {
          encoding.maxFramerate = capFrameRate;
        } else {
          delete encoding.maxFramerate;
        }

        if (maxWidth && width > maxWidth) {
          encoding.scaleResolutionDownBy = Math.ceil(width / maxWidth);
        } else {
          delete encoding.scaleResolutionDownBy;
        }
      }

      parameters.encodings = [encoding];
      void sender.setParameters(parameters).catch(() => undefined);
    }
  }

  removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    entry.stopDetector();
    entry.pc.close();
    this.peers.delete(userId);
    // Sobrou menos gente: os peers restantes podem voltar a receber mais fps.
    if (this.peers.size > 0) this.reconfigureAllMediaPriorities();
  }

  closeAll(): void {
    for (const userId of [...this.peers.keys()]) this.removePeer(userId);
  }
}
