// AudioWorklet que transforma os blocos PCM do processo principal em uma
// trilha de MediaStream. O buffer pequeno absorve a jitter do IPC sem
// acrescentar latência perceptível.

class FreehubSystemAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.queuedFrames = 0;
    this.started = false;
    this.silentFrames = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      const samples = new Int16Array(data);
      if (samples.length < 2) return;
      this.queue.push(samples);
      this.queuedFrames += samples.length >> 1;

      // Um segundo no máximo: áudio atrasado não tem valor em uma transmissão.
      while (this.queuedFrames > sampleRate && this.queue.length > 1) {
        const dropped = this.queue.shift();
        this.queuedFrames -= dropped.length >> 1;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const left = output[0];
    const right = output.length > 1 ? output[1] : output[0];
    const frames = left.length;

    // Só começa a tocar com ~40 ms acumulados, para não picotar no início.
    if (!this.started) {
      if (this.queuedFrames < 1920) return true;
      this.started = true;
    }

    let written = 0;
    while (written < frames) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
        if (this.current) this.queuedFrames -= this.current.length >> 1;
        if (!this.current) break;
      }

      const available = (this.current.length - this.offset) >> 1;
      const take = Math.min(frames - written, available);
      for (let i = 0; i < take; i += 1) {
        const l = this.current[this.offset + i * 2] / 32768;
        left[written + i] = l;
        if (right !== left) {
          right[written + i] = this.current[this.offset + i * 2 + 1] / 32768;
        }
      }
      this.offset += take * 2;
      written += take;
    }

    if (written === 0) {
      this.silentFrames += frames;
      // Depois de ~200 ms sem dados, volta ao estado de pré-buffer. Assim,
      // quando o som voltar, ele entra inteiro em vez de picotado.
      if (this.silentFrames > 9600) {
        this.started = false;
        this.silentFrames = 0;
      }
    } else {
      this.silentFrames = 0;
    }

    return true;
  }
}

registerProcessor('freehub-system-audio', FreehubSystemAudioProcessor);
