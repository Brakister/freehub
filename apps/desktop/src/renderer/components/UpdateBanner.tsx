import { useEffect, useState } from 'react';

interface UpdateState {
  status:
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  message: string;
  percent?: number;
  version?: string;
}

/**
 * Banner de atualização: só aparece quando há nova versão disponível, falha
 * ou após baixar. No navegador (sem electronAPI) não renderiza nada.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const api = window.electronAPI;
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onUpdateStatus(setState);
    return unsubscribe;
  }, [api]);

  if (!api) return null;
  if (!state) return null;

  const busy = state.status === 'checking' || state.status === 'downloading';
  const actionable = state.status === 'available' || state.status === 'downloaded';

  if (state.status === 'not-available') return null;
  if (!actionable && state.status !== 'error') return null;

  const handleAction = (): void => {
    if (state.status === 'downloaded') {
      void api.installUpdate();
    } else if (state.status === 'available') {
      void api.downloadUpdate();
    } else if (state.status === 'error') {
      void api.checkForUpdates();
    }
  };

  const label =
    state.status === 'downloaded'
      ? 'Instalar e reiniciar'
      : state.status === 'available'
        ? 'Baixar agora'
        : 'Tentar novamente';

  return (
    <div
      data-testid="update-banner"
      className="mx-auto mb-4 flex w-[90%] items-center justify-between gap-3 rounded-lg bg-[#2b2d31] px-4 py-3 text-sm"
    >
      <div className="flex items-center gap-2 text-[#dbdee1]">
        {state.status === 'downloading' && (
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#1e1f22]">
            <div
              className="h-full rounded-full bg-[#5865f2] transition-all"
              style={{ width: `${state.percent ?? 0}%` }}
            />
          </div>
        )}
        <span>{state.message}</span>
      </div>
      {!busy && (
        <button
          onClick={handleAction}
          className="shrink-0 rounded bg-[#5865f2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4752c4]"
        >
          {label}
        </button>
      )}
    </div>
  );
}
