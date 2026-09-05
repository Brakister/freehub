import { ICE_SERVERS } from '@discord3/shared';
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
  remoteStream: MediaStream;
  stopDetector: () => void;
}

/**
 * Gerencia conexões WebRTC em malha (mesh). Encapsula signaling, mídia
 * local e detecção de fala por peer remoto.
 */
export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private localStream: MediaStream | null = null;

  constructor(private callbacks: PeerCallbacks) {}

  /** Define o stream de microfone local (deve ser chamado antes de createPeer). */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
  }

  /** Cria (ou retorna) a conexão com um peer, já anexando o stream local. */
  ensurePeer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const remoteStream = new MediaStream();
    const entry: PeerEntry = {
      pc,
      remoteStream,
      stopDetector: () => undefined,
    };
    this.peers.set(userId, entry);

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.callbacks.sendSignal(userId, { type: 'ice-candidate', candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => {
        if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
      });
      entry.stopDetector();
      const detector = new VoiceActivityDetector(remoteStream);
      detector.onChange((speaking, level) =>
        this.callbacks.onSpeakingChange?.(userId, speaking, level),
      );
      entry.stopDetector = detector.start();
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
      if (pc.signalingState !== 'stable') {
        await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      }
    } else if (s.type === 'ice-candidate' && s.candidate) {
      await pc.addIceCandidate(s.candidate).catch(() => undefined);
    }
  }

  /** Inicia a negociação criando uma oferta para o peer. */
  async call(userId: string): Promise<void> {
    const pc = this.ensurePeer(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.callbacks.sendSignal(userId, { type: 'offer', sdp: offer.sdp });
  }

  /**
   * Publica uma trilha de vídeo (screen share) para todos os peers e
   * renegocia. Deve ser chamado após setLocalStream.
   */
  async publishScreenTrack(stream: MediaStream): Promise<void> {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    for (const userId of this.getPeerIds()) {
      const entry = this.peers.get(userId);
      if (!entry) continue;
      entry.pc.addTrack(videoTrack, stream);
      await this.call(userId);
    }
  }

  /** Remove a trilha de vídeo compartilhada e renegocia. */
  async unpublishScreenTrack(): Promise<void> {
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) entry.pc.removeTrack(sender);
    }
    for (const userId of this.getPeerIds()) {
      await this.call(userId);
    }
  }

  /** Retorna o stream de áudio remoto de um peer, se houver. */
  getRemoteStream(userId: string): MediaStream | null {
    return this.peers.get(userId)?.remoteStream ?? null;
  }

  getPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    entry.stopDetector();
    entry.pc.close();
    this.peers.delete(userId);
  }

  closeAll(): void {
    for (const userId of [...this.peers.keys()]) this.removePeer(userId);
  }
}
