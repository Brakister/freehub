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
    const voiceStream = new MediaStream();
    const screenStream = new MediaStream();
    const entry: PeerEntry = {
      pc,
      voiceStream,
      screenStream,
      screenTracks: new Set<MediaStreamTrack>(),
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
      const isScreen = (e.streams[0]?.getVideoTracks().length ?? 0) > 0;
      if (e.track.kind === 'audio') {
        if (isScreen) {
          // áudio do sistema vindo da tela compartilhada (vídeo/jogo) → só no stream da tela
          for (const t of screenStream.getAudioTracks()) screenStream.removeTrack(t);
          if (!screenStream.getTracks().includes(e.track)) screenStream.addTrack(e.track);
        } else if (!voiceStream.getTracks().includes(e.track)) {
          // voz do microfone → stream de voz separado (VAD somente aqui)
          voiceStream.addTrack(e.track);
          entry.stopDetector();
          const detector = new VoiceActivityDetector(voiceStream, { threshold: 0.008 });
          detector.onChange((speaking, level) =>
            this.callbacks.onSpeakingChange?.(userId, speaking, level),
          );
          entry.stopDetector = detector.start();
        }
      } else {
        // Vídeo remoto (screen share): substitui o vídeo anterior e acompanha o fim.
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
   * Publica as trilhas de vídeo e áudio da tela (screen share) para todos os
   * peers e renegocia. O áudio do display envia o som do sistema; o áudio de
   * voz dos demais continua tocando normalmente.
   */
  async publishScreenTrack(stream: MediaStream): Promise<void> {
    for (const entry of this.peers.values()) {
      for (const track of stream.getTracks()) {
        if (entry.screenTracks.has(track)) continue;
        entry.screenTracks.add(track);
        entry.pc.addTrack(track, stream);
      }
    }
    for (const userId of this.getPeerIds()) {
      await this.call(userId);
    }
  }

  /** Remove apenas as trilhas de screen share e renegocia (voz permanece). */
  async unpublishScreenTrack(): Promise<void> {
    for (const entry of this.peers.values()) {
      for (const sender of entry.pc.getSenders()) {
        if (sender.track && entry.screenTracks.has(sender.track)) {
          entry.pc.removeTrack(sender);
        }
      }
      entry.screenTracks.clear();
    }
    for (const userId of this.getPeerIds()) {
      await this.call(userId);
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
