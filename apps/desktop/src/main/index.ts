import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { isDev } from './util';

import { registerUpdater, setupUpdaterIpc } from './updater';
import { APP_NAME } from './constants';
import { startServer } from './server';
import { pickDesktopSource } from './displayPicker';

const isSmokeTest = process.env.FREEHUB_SMOKE === '1';

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    title: APP_NAME,
    show: !isSmokeTest,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && !isSmokeTest) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow
      .loadFile(join(__dirname, '../renderer/index.html'))
      .then(() => {
        if (isSmokeTest) console.log('[smoke] loadFile resolved');
      })
      .catch((err) => {
        console.error('[smoke] loadFile falhou:', err);
      });
  }

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[smoke] did-fail-load (${errorCode}): ${errorDescription} url=${validatedURL}`,
      );
      if (isSmokeTest) app.exit(2);
    },
  );
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[smoke] render-process-gone: ${details.reason}`);
  });
  mainWindow.webContents.on('console-message', (_event, _level, message, line, source) => {
    console.log(`[renderer] ${message} (${source}:${line})`);
  });

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[smoke] renderer carregado');
      setTimeout(() => {
        console.log('[smoke] encerrando');
        app.exit(0);
      }, 2500);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  registerUpdater();
  setupUpdaterIpc();

  // Sem este handler o Electron rejeita navigator.mediaDevices.getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void pickDesktopSource().then((source) => {
      if (source) {
        // video = tela/janela escolhida; audio 'loopback' = áudio do sistema.
        callback({ video: source, audio: 'loopback' });
      } else {
        callback({});
      }
    });
  });

  void startServer();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Exposição de metadados para o renderer.
ipcMain.handle('app:get-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
}));
