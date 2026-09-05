import { app, ipcMain, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { GITHUB_OWNER, GITHUB_REPO, UPDATE_SERVER_URL } from './constants';

let configured = false;

function sendStatus(status: string, extra: Record<string, unknown> = {}): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('update:status', { status, ...extra });
  }
}

function configure(): void {
  if (configured) return;
  configured = true;

  // Baixa atualizações automaticamente assim que detectadas; o banner mostra
  // o progresso e oferece "Instalar e reiniciar" ao concluir.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  if (
    process.env.UPDATE_SERVER_URL ||
    UPDATE_SERVER_URL !== 'https://updates.example.com/freehub'
  ) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: process.env.UPDATE_SERVER_URL ?? UPDATE_SERVER_URL,
    });
  } else {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
  }

  autoUpdater.on('checking-for-update', () =>
    sendStatus('idle', { message: 'Verificando atualizações…' }),
  );
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // Com autoDownload=true o download começa sozinho; já reporta 'downloading'
    // para o banner mostrar a barra de progresso em vez do botão "Baixar agora".
    sendStatus('downloading', {
      message: `Nova versão ${info.version} disponível — baixando…`,
      version: info.version,
      percent: 0,
    });
  });
  autoUpdater.on('update-not-available', () =>
    sendStatus('not-available', { message: 'Você está na versão mais recente.' }),
  );
  autoUpdater.on('download-progress', (p) =>
    sendStatus('downloading', { percent: Math.round(p.percent), message: 'Baixando atualização…' }),
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    sendStatus('downloaded', {
      message: `Atualização ${info.version} pronta para instalar.`,
      version: info.version,
    }),
  );
  autoUpdater.on('error', (err) =>
    sendStatus('error', { message: `Erro na atualização: ${err.message}` }),
  );
}

export function registerUpdater(): void {
  app.whenReady().then(() => {
    configure();
    // Num app não-empacotado (dev) o autoUpdater falha esperado; apenas loga.
    autoUpdater.checkForUpdates().catch((err) => {
      if (!app.isPackaged) console.log('[updater] desabilitado em dev:', err.message);
    });
  });
}

export function setupUpdaterIpc(): void {
  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { status: 'checking', message: 'Verificando atualizações…' } as const;
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      } as const;
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('update:install', async () => {
    autoUpdater.quitAndInstall();
  });
}
