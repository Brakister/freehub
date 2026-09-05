/**
 * Testador de microfone: captura áudio do dispositivo selecionado e
 * disponibiliza nível ao vivo, além de possibilitar gravar/ouvir um playback.
 */

export type LevelListener = (level: number) => void;

export class MicrophoneTester {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levelListeners = new Set<LevelListener>();
  private liveStream: MediaStream | null = null;

  get stream(): MediaStream | null {
    return this.liveStream;
  }

  /** Inicia captura e passa a reportar o nível (0..1). */
  async start(deviceId?: string): Promise<void> {
    await this.stop();
    this.liveStream = await navigator.mediaDevices.getUserMedia(
      deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true },
    );
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.liveStream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.fftSize);

    this.levelTimer = setInterval(() => this.readLevel(), 60);
  }

  private readLevel(): void {
    if (!this.analyser || !this.data) return;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    for (const l of this.levelListeners) l(rms);
  }

  setLevelListener(fn: LevelListener): () => void {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  /**
   * Grava os N segundos atuais e devolve uma URL de áudio tocável.
   * Retorna null se o AudioContext estiver suspenso (autoplay policy).
   */
  async recordAndGetUrl(seconds = 5): Promise<string | null> {
    if (!this.ctx || !this.liveStream) return null;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const mediaRecorder = new MediaRecorder(this.liveStream);
    const chunks: BlobPart[] = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

    const stopped = new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => resolve();
    });
    mediaRecorder.start();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    mediaRecorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: 'audio/webm' });
    return URL.createObjectURL(blob);
  }

  async stop(): Promise<void> {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.source?.disconnect();
    await this.ctx?.close().catch(() => undefined);
    this.liveStream?.getTracks().forEach((t) => t.stop());
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.liveStream = null;
  }
}
