import { useEffect, useRef, useState } from 'react';
import { enumerateAudioDevices, MicrophoneTester, type AudioDevice } from '@freehub/webrtc';
import { useSettings } from '../settings';

interface SettingsModalProps {
  open: boolean;
  onClose(): void;
}

export function SettingsModal(props: SettingsModalProps): React.JSX.Element | null {
  const settings = useSettings();
  const [devices, setDevices] = useState<{ microphones: AudioDevice[]; speakers: AudioDevice[] }>({
    microphones: [],
    speakers: [],
  });
  const [testing, setTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const testerRef = useRef<MicrophoneTester | null>(null);

  useEffect(() => {
    if (!props.open) return;
    enumerateAudioDevices()
      .then(setDevices)
      .catch(() => undefined);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) {
      void testerRef.current?.stop();
      testerRef.current = null;
      setTesting(false);
      setTestLevel(0);
      setRecordingUrl((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
    }
  }, [props.open]);

  const handleMicTest = async (): Promise<void> => {
    if (testing) {
      void testerRef.current?.stop();
      testerRef.current = null;
      setTesting(false);
      setTestLevel(0);
      return;
    }
    setTesting(true);
    setRecordingUrl(null);
    const tester = new MicrophoneTester();
    testerRef.current = tester;
    tester.setLevelListener((level) => setTestLevel(level));
    try {
      await tester.start(settings.inputDeviceId || undefined);
    } catch {
      setTesting(false);
      alert('Não foi possível acessar o microfone.');
      return;
    }
  };

  const handleRecord = async (): Promise<void> => {
    const url = await testerRef.current?.recordAndGetUrl(4);
    if (url) {
      setRecordingUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return url;
      });
    }
  };

  if (!props.open) return null;

  return (
    <div
      data-testid="settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-[#1e1f22] text-[#dbdee1] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-black/30 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Configurações</h2>
          <button
            onClick={props.onClose}
            aria-label="Fechar"
            className="rounded p-1 text-[#b5bac1] transition hover:bg-[#2b2d31]"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section>
            <label className="mb-1 block text-xs font-semibold text-[#949ba4]">
              Servidor de voz (URL)
            </label>
            <input
              type="url"
              value={settings.serverUrl}
              onChange={(e) => settings.setServerUrl(e.target.value)}
              placeholder="http://localhost:3001 (padrão)"
              spellCheck={false}
              className="w-full rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none ring-offset-2 transition focus:ring-2 focus:ring-[#5865f2]"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[#949ba4]">
              Vazio = servidor padrão local. Para entrar numa sala hospedada em outra máquina/prestador,
              cole a URL pública (ex.: <span className="font-mono">https://xyz.trycloudflare.com</span>).
              A conexão é refeita automaticamente.
            </p>
          </section>

          <section>
            <label className="mb-1 block text-xs font-semibold text-[#949ba4]">Apelido</label>
            <input
              value={settings.nickname}
              onChange={(e) => settings.setNickname(e.target.value)}
              maxLength={24}
              className="w-full rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none ring-offset-2 transition focus:ring-2 focus:ring-[#5865f2]"
            />
          </section>

          <section>
            <label className="mb-1 block text-xs font-semibold text-[#949ba4]">Microfone</label>
            <select
              value={settings.inputDeviceId}
              onChange={(e) => settings.setInputDeviceId(e.target.value)}
              className="w-full rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-[#5865f2]"
            >
              <option value="">Dispositivo padrão</option>
              {devices.microphones.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </section>

          <section>
            <label className="mb-1 block text-xs font-semibold text-[#949ba4]">Alto-falante</label>
            <select
              value={settings.outputDeviceId}
              onChange={(e) => settings.setOutputDeviceId(e.target.value)}
              className="w-full rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-[#5865f2]"
            >
              <option value="">Dispositivo padrão</option>
              {devices.speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </section>

          <section>
            <label className="mb-1 flex items-center justify-between text-xs font-semibold text-[#949ba4]">
              <span>Volume do microfone</span>
              <span className="font-mono">{Math.round(settings.micGain * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.micGain}
              onChange={(e) => settings.setMicGain(Number(e.target.value))}
              className="w-full accent-[#5865f2]"
            />
          </section>

          <section>
            <label className="mb-1 flex items-center justify-between text-xs font-semibold text-[#949ba4]">
              <span>Volume do alto-falante</span>
              <span className="font-mono">{Math.round(settings.speakerVolume * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.speakerVolume}
              onChange={(e) => settings.setSpeakerVolume(Number(e.target.value))}
              className="w-full accent-[#5865f2]"
            />
          </section>

          <section className="rounded-lg bg-[#2b2d31] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#949ba4]">Teste de microfone</span>
              <button
                onClick={() => void handleMicTest()}
                data-testid="mic-test-button"
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  testing
                    ? 'bg-[#d83c3e] text-white hover:bg-[#b93a3c]'
                    : 'bg-[#5865f2] text-white hover:bg-[#4752c4]'
                }`}
              >
                {testing ? 'Parar' : 'Testar'}
              </button>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[#1e1f22]">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  testLevel > 0.04 ? 'bg-green-500' : 'bg-[#5865f2]'
                }`}
                style={{ width: `${Math.min(100, testLevel * 200)}%` }}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void handleRecord()}
                disabled={!testing}
                className="rounded bg-[#23a559] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#1e8c4c] disabled:opacity-40"
              >
                Gravar 4s
              </button>
              {recordingUrl && (
                <audio
                  controls
                  src={recordingUrl}
                  className="h-8 w-40"
                  data-testid="recording-playback"
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
