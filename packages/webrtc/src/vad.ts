/**
 * Detecção de atividade de voz (VAD) baseada em análise simples de energia
 * do áudio. Ideal para indicadores de "falando" sem dependências externas.
 */

export interface VADOptions {
  /** Limiar RMS (0..1) acima do qual considera-se fala. */
  threshold?: number;
  /** Janela (ms) para suavizar/mantém a indicação acesa. */
  holdMs?: number;
}

export type VADListener = (speaking: boolean, level: number) => void;

export class VoiceActivityDetector {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private data: Uint8Array<ArrayBuffer>;
  private threshold: number;
  private holdMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<VADListener>();

  constructor(stream: MediaStream, opts: VADOptions = {}) {
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.15;
    source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.fftSize);
    this.threshold = opts.threshold ?? 0.012;
    this.holdMs = opts.holdMs ?? 250;
  }

  onChange(listener: VADListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(speaking: boolean, level: number): void {
    for (const l of this.listeners) l(speaking, level);
  }

  private measure(): number {
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.data.length);
  }

  /**
   * Inicia a verificação periódica. Retorna função para parar.
   */
  start(): () => void {
    // Garante o contexto ativo (parado caso a criação não tenha ocorrido em
    // um gesto de usuário; no Electron não deve estar suspenso por padrão).
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    const tick = (): void => {
      const level = this.measure();
      if (level >= this.threshold) {
        if (this.timer === null) this.emit(true, level);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.emit(false, 0);
        }, this.holdMs);
      }
    };
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }
}
