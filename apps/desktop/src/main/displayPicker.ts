import { BrowserWindow, desktopCapturer, ipcMain, type DesktopCapturerSource } from 'electron';
import { join } from 'node:path';

interface SerializedSource {
  id: string;
  name: string;
  thumbnail: string;
}

let currentSources: DesktopCapturerSource[] = [];
let selectHandler: ((source: DesktopCapturerSource | null) => void) | null = null;
let pickerWindow: BrowserWindow | null = null;
let handlersRegistered = false;

function registerPickerIpc(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('picker:list', (): SerializedSource[] =>
    currentSources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    })),
  );

  ipcMain.on('picker:select', (_event, id: string) => {
    const source = currentSources.find((s) => s.id === id) ?? null;
    finishPick(source);
  });

  ipcMain.on('picker:cancel', () => finishPick(null));
}

function finishPick(source: DesktopCapturerSource | null): void {
  const handler = selectHandler;
  selectHandler = null;
  if (pickerWindow) {
    pickerWindow.destroy();
    pickerWindow = null;
  }
  handler?.(source);
}

function buildPickerHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #1e1f22;
    color: #dbdee1;
    font-family: system-ui, sans-serif;
  }
  h1 { margin: 0; font-size: 15px; color: #fff; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,.3); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px; max-height: 420px; overflow-y: auto; }
  button.card {
    display: flex; flex-direction: column; gap: 8px; align-items: center;
    padding: 10px; border: 1px solid #3a3d41; border-radius: 10px; background: #2b2d31;
    cursor: pointer; transition: border-color .15s, background .15s; min-width: 0;
  }
  button.card:hover { border-color: #5865f2; background: #33363b; }
  button.card img { width: 100%; height: 100px; object-fit: cover; border-radius: 6px; background: #000; }
  button.card span { font-size: 12px; color: #b5bac1; word-break: break-word; text-align: center; }
  .empty { padding: 30px; text-align: center; color: #949ba4; font-size: 13px; }
  footer { display: flex; justify-content: flex-end; padding: 12px 14px; border-top: 1px solid rgba(0,0,0,.3); }
  footer button { background: #3a3d41; border: 0; color: #dbdee1; padding: 7px 16px; border-radius: 6px; cursor: pointer; }
  footer button:hover { background: #4a4d51; }
</style>
</head>
<body>
<header><h1>Compartilhar tela</h1></header>
<div class="grid" id="grid"></div>
<footer><button id="cancel">Cancelar</button></footer>
<script>
  function escape(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const grid = document.getElementById('grid');
  const pickerApi = window.pickerApi;
  pickerApi.list().then((sources) => {
    if (!sources.length) {
      grid.innerHTML = '<div class="empty">Nenhuma tela ou janela encontrada.</div>';
      return;
    }
    for (const s of sources) {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML =
        (s.thumbnail
          ? '<img src="' + s.thumbnail + '" alt="" />'
          : '<div style="width:100%;height:100px;background:#000;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#949ba4;font-size:28px">\\u{1F4BB}</div>') +
        '<span>\${escape(s.name)}</span>';
      b.addEventListener('click', () => pickerApi.select(s.id));
      grid.appendChild(b);
    }
  });
  document.getElementById('cancel').addEventListener('click', () => pickerApi.cancel());
</script>
</body>
</html>`;
}

export async function pickDesktopSource(): Promise<DesktopCapturerSource | null> {
  registerPickerIpc();
  currentSources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
  });
  if (currentSources.length === 0) return null;

  pickerWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Compartilhar tela',
    backgroundColor: '#1e1f22',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/picker.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  pickerWindow.setMenuBarVisibility(false);
  pickerWindow.once('ready-to-show', () => pickerWindow?.show());
  pickerWindow.on('closed', () => {
    pickerWindow = null;
    if (selectHandler) {
      const handler = selectHandler;
      selectHandler = null;
      handler(null);
    }
  });
  await pickerWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPickerHtml()));

  return new Promise<DesktopCapturerSource | null>((resolve) => {
    selectHandler = resolve;
  });
}