export type PingListener = (pingMs: number) => void;

export interface PingStats {
  current: number;
  average: number;
  min: number;
  max: number;
}

/**
 * Monitors connection ping using Socket.IO's built-in ping mechanism.
 * Reports latency in milliseconds.
 */
export class PingMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<PingListener>();
  private socket: { emit: (event: string, data?: unknown) => void; on: (event: string, cb: (...args: unknown[]) => void) => void; off: (event: string, cb: (...args: unknown[]) => void) => void } | null = null;
  private lastSendTime = 0;
  private currentPing = 0;
  private pingHistory: number[] = [];

  constructor() {}

  start(socket: { emit: (event: string, data?: unknown) => void; on: (event: string, cb: (...args: unknown[]) => void) => void; off: (event: string, cb: (...args: unknown[]) => void) => void }): void {
    this.stop();
    this.socket = socket;

    socket.on('pong', this.handlePong);

    this.interval = setInterval(() => {
      this.sendPing();
    }, 3000);

    this.sendPing();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.socket) {
      this.socket.off('pong', this.handlePong);
      this.socket = null;
    }
  }

  onPing(listener: PingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStats(): PingStats {
    const history = this.pingHistory.length > 0 ? this.pingHistory : [0];
    return {
      current: this.currentPing,
      average: Math.round(history.reduce((a, b) => a + b, 0) / history.length),
      min: Math.min(...history),
      max: Math.max(...history),
    };
  }

  getPingColor(): 'green' | 'orange' | 'red' {
    if (this.currentPing < 80) return 'green';
    if (this.currentPing < 150) return 'orange';
    return 'red';
  }

  private sendPing = (): void => {
    if (!this.socket) return;
    this.lastSendTime = performance.now();
    this.socket.emit('ping');
  };

  private handlePong = (): void => {
    const latency = Math.round(performance.now() - this.lastSendTime);
    this.currentPing = latency;
    this.pingHistory.push(latency);
    if (this.pingHistory.length > 30) this.pingHistory.shift();
    for (const l of this.listeners) l(latency);
  };
}
