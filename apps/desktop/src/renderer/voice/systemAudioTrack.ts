import { SYSTEM_AUDIO_FORMAT } from '../../shared/ipc';

export interface SystemAudioTrackHandle {
  track: MediaStreamTrack;
  dispose(): void;
}

/**
 * Monta uma trilha de áudio a partir do PCM que o processo principal recebe
 * do helper nativo. O AudioContext não é ligado à saída do computador: o som
 * só existe dentro da trilha transmitida.
 */
export async function createSystemAudioTrack(): Promise<SystemAudioTrackHandle | null> {
  const bridge = window.electronAPI?.systemAudio;
  if (!bridge) return null;

  const context = new AudioContext({
    sampleRate: SYSTEM_AUDIO_FORMAT.sampleRate,
    latencyHint: 'interactive',
  });

  try {
    const workletUrl = new URL(
      'worklets/freehub-system-audio.js',
      document.baseURI,
    ).href;
    await context.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(context, 'freehub-system-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [SYSTEM_AUDIO_FORMAT.channels],
    });
    const destination = context.createMediaStreamDestination();
    node.connect(destination);

    const stopData = bridge.onData((chunk) => {
      const copy = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      );
      node.port.postMessage(copy, [copy]);
    });
    // A captura pode terminar (helper encerrado) sem derrubar a transmissão:
    // a trilha continua viva e simplesmente fica em silêncio.
    const stopEnded = bridge.onEnded(() => undefined);

    await context.resume();
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('o destino não produziu uma trilha de áudio');
    track.contentHint = 'music';

    return {
      track,
      dispose: () => {
        stopData();
        stopEnded();
        try {
          node.disconnect();
        } catch {
          // Já desconectado.
        }
        track.stop();
        void context.close();
      },
    };
  } catch (error) {
    console.error('[system-audio] falha ao criar a trilha:', error);
    void context.close();
    return null;
  }
}
