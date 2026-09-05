/**
 * Controle de volume independente do WebRTC: permite ajustar o ganho do
 * microfone local e o volume dos alto-falantes remotos via GainNode.
 */

export class VolumeController {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private micGain: GainNode | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  /** Define o ganho do alto-falante (0..2, 1 = volume normal). */
  setSpeakerVolume(value: number): void {
    this.masterGain.gain.value = clamp(value, 0, 2);
  }

  /**
   * Aplica o ganho do microfone ao stream e devolve um novo stream processado.
   * Chamar novamente com outro stream recria o processador.
   */
  applyMicGain(stream: MediaStream, gain: number): MediaStream {
    const source = this.ctx.createMediaStreamSource(stream);
    if (this.micGain) this.micGain.disconnect();
    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = clamp(gain, 0, 2);
    source.connect(this.micGain);
    const dest = this.ctx.createMediaStreamDestination();
    this.micGain.connect(dest);
    return dest.stream;
  }

  setMicGain(gain: number): void {
    if (this.micGain) this.micGain.gain.value = clamp(gain, 0, 2);
  }

  close(): void {
    void this.ctx.close();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
