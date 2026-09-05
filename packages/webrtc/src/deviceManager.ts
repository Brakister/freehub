/**
 * Gerência de dispositivos de mídia (microfone, alto-falante).
 * Encapsula todas as chamadas a getUserMedia/enumerateDevices para facilitar
 * o teste e a troca de dispositivos em tempo de execução.
 */

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface MediaDevices {
  microphones: AudioDevice[];
  speakers: AudioDevice[];
}

const normalizeDevice = (d: MediaDeviceInfo): AudioDevice => ({
  deviceId: d.deviceId,
  label: d.label || `Dispositivo ${d.deviceId.slice(0, 4)}`,
  groupId: d.groupId,
});

export async function enumerateAudioDevices(): Promise<MediaDevices> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { microphones: [], speakers: [] };
  }
  // Solicita a permissão antes para obter os labels.
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Ignora: permissão negada ainda permite listar sem labels.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((d) => d.kind === 'audioinput').map(normalizeDevice);
  const speakers = devices.filter((d) => d.kind === 'audiooutput').map(normalizeDevice);

  return { microphones, speakers };
}

/** Cria um stream a partir do dispositivo de microfone selecionado. */
export async function getMicrophoneStream(deviceId?: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = deviceId
    ? { audio: { deviceId: { exact: deviceId } } }
    : { audio: true };
  return navigator.mediaDevices.getUserMedia(constraints);
}

/** Setter para dispositivos de saída suportados (Chrome/Edge). */
export function setAudioOutput(element: HTMLMediaElement, deviceId: string): void {
  if (typeof element.setSinkId !== 'function') return;
  element.setSinkId(deviceId).catch(() => {
    /* não suportado */
  });
}
