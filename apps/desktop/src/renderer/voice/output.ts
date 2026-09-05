import { setAudioOutput } from '@discord3/webrtc';

const audioElements = new Set<HTMLAudioElement>();

export function registerAudioElement(el: HTMLAudioElement): () => void {
  audioElements.add(el);
  return () => audioElements.delete(el);
}

export function applyOutputToElements(deviceId: string): void {
  if (!deviceId) return;
  for (const el of audioElements) {
    setAudioOutput(el, deviceId);
  }
}
