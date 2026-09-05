import { ClientEvent, type User } from '@freehub/shared';
import {
  getMicrophoneStream,
  PeerManager,
  VoiceActivityDetector,
  VolumeController,
} from '@freehub/webrtc';
import { getSocket } from '../net/socket';
import { useConnectionStore } from '../stores/useConnectionStore';

/**
 * Sessão de áudio do app: gere o microfone local, os peers WebRTC e aplica
 * ganho/volume. Reagrupa também o relógio de detecção de voz local.
 */
export class VoiceSession {
  private peers: PeerManager;
  private volume: VolumeController | null = null;
  private rawStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private localVad: VoiceActivityDetector | null = null;
  private stopLocalVad: (() => void) | null = null;

  constructor(readonly inputDeviceId: string) {
    this.peers = new PeerManager({
      sendSignal: (targetUserId, signal) => {
        getSocket().emit(ClientEvent.signaling, { targetUserId, signal });
      },
      onSpeakingChange: (userId, speaking) => {
        useConnectionStore.getState().setSpeaking(userId, speaking);
      },
    });
  }

  async init(): Promise<void> {
    this.rawStream = await getMicrophoneStream(this.inputDeviceId || undefined);
    this.volume = new VolumeController();
    this.processedStream = this.volume.applyMicGain(this.rawStream, 1);
    this.peers.setLocalStream(this.processedStream);
  }

  onJoinedRoom(users: User[], selfId: string): void {
    this.startLocalVad();
    for (const u of users) {
      if (u.id !== selfId) void this.peers.call(u.id);
    }
  }

  onPeerLeft(userId: string): void {
    this.peers.removePeer(userId);
  }

  onSignal(fromUserId: string, signal: unknown): void {
    void this.peers.handleIncomingSignal(fromUserId, signal).catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.rawStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  applyMicGain(gain: number): void {
    this.volume?.setMicGain(gain);
  }

  applySpeakerVolume(volume: number): void {
    this.volume?.setSpeakerVolume(volume);
  }

  getRemoteStream(userId: string): MediaStream | null {
    return this.peers.getRemoteStream(userId);
  }

  publishScreenShare(stream: MediaStream): Promise<void> {
    return this.peers.publishScreenTrack(stream);
  }

  unpublishScreenShare(): Promise<void> {
    return this.peers.unpublishScreenTrack();
  }

  private startLocalVad(): void {
    if (!this.processedStream) return;
    this.stopLocalVad?.();
    this.localVad = new VoiceActivityDetector(this.processedStream, { threshold: 0.01 });
    this.localVad.onChange((speaking) => {
      const { selfId, muted } = useConnectionStore.getState();
      if (!selfId) return;
      if (muted && speaking) return;
      useConnectionStore.getState().setSpeaking(selfId, speaking);
    });
    this.stopLocalVad = this.localVad.start();
  }

  async dispose(): Promise<void> {
    this.stopLocalVad?.();
    this.stopLocalVad = null;
    this.localVad = null;
    this.peers.closeAll();
    this.rawStream?.getTracks().forEach((t) => t.stop());
    this.rawStream = null;
    this.processedStream = null;
    this.volume?.close();
    this.volume = null;
  }
}
