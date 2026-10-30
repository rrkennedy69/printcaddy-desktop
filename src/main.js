'use strict';
// PrintCaddy desktop shell (AGPL-3.0). Serves the PrintCaddy web build from app://printcaddy/.
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const oauth = require('./oauth');
const updates = require('./updates');

// ---- memory: 64-bit V8 heap scaled to RAM (half of RAM, 4-16 GB) -------------------------
const ramMB = Math.floor(os.totalmem() / 1048576);
const heapMB = Math.max(4096, Math.min(16384, Math.floor(ramMB / 2)));
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapMB}`);
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const ORIGIN = 'app://printcaddy';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

// ---- settings: last folder + recent files ---------------------------------------------------
const STATE = () => path.join(app.getPath('userData'), 'desktop-state.json');
function readState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return { lastDir: '', recent: [] }; } }
function writeState(s) { try { fs.writeFileSync(STATE(), JSON.stringify(s, null, 1)); } catch {} }
function addRecent(file) {
  const s = readState(); s.lastDir = path.dirname(file);
  if (/\.(lyl|skf)$/i.test(file)) s.recent = [file, ...(s.recent || []).filter((f) => f !== file)].slice(0, 12);
  writeState(s);
}

let win = null;
let pendingOpen = process.argv.slice(1).find((a) => /\.(lyl|skf|stl|3mf|obj)$/i.test(a)) || null;

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  let f = path.normalize(path.join(WEB, p));
  if (!f.startsWith(WEB)) return null;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch {}
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) return null;
  return f;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, title: 'PrintCaddy', backgroundColor: '#fffaf3',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: false },
  });
  win.removeMenu();
  win.loadURL(ORIGIN + '/');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  updates.attach(win);
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const f = resolveFile(u.pathname) || resolveFile('/404.html');
    if (!f) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(f).toString());
  });
  // Every download (.lyl save, STL, 3MF, backups) goes through a native Save dialog in the last folder.
  session.defaultSession.on('will-download', (_e, item) => {
    const s = readState();
    item.setSaveDialogOptions({ title: 'Save', defaultPath: path.join(s.lastDir || app.getPath('documents'), item.getFilename()) });
    item.once('done', (_ev, state) => { if (state === 'completed') { addRecent(item.getSavePath()); win && win.webContents.send('desktop:recent-changed'); } });
  });
  createWindow();
});

// ---- single instance + file associations ----------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.slice(1).find((a) => /\.(lyl|skf|stl|3mf|obj)$/i.test(a));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) win.webContents.send('desktop:open-path', f); }
});
app.on('window-all-closed', () => app.quit());

// ---- IPC --------------------------------------------------------------------------------------
ipcMain.handle('desktop:info', () => ({ version: app.getVersion(), heapMB, ramMB, platform: process.platform, arch: process.arch }));
ipcMain.handle('desktop:pending-open', () => { const f = pendingOpen; pendingOpen = null; return f; });
ipcMain.handle('desktop:recent', () => (readState().recent || []).filter((f) => fs.existsSync(f)));
ipcMain.handle('desktop:forget-recent', (_e, f) => { const s = readState(); s.recent = (s.recent || []).filter((x) => x !== f); writeState(s); });
ipcMain.handle('desktop:open-dialog', async () => {
  const s = readState();
  const r = await dialog.showOpenDialog(win, { title: 'Open design', defaultPath: s.lastDir || app.getPath('documents'), properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PrintCaddy designs and models', extensions: ['lyl', 'skf', 'stl', '3mf', 'obj', 'step', 'stp', 'svg', 'dxf', 'zip'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled) return [];
  return r.filePaths;
});
ipcMain.handle('desktop:read-file', async (_e, f) => {
  const bytes = await fs.promises.readFile(f); addRecent(f);
  return { name: path.basename(f), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
});
ipcMain.handle('desktop:save-as', async (_e, { name, bytes, filters }) => {
  const s = readState();
  const r = await dialog.showSaveDialog(win, { title: 'Save As', defaultPath: path.join(s.lastDir || app.getPath('documents'), name), filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes)); addRecent(r.filePath); return r.filePath;
});
ipcMain.handle('desktop:show-in-folder', (_e, f) => shell.showItemInFolder(f));
ipcMain.handle('oauth:token', (_e, opts) => oauth.getToken(opts || {}));
ipcMain.handle('oauth:revoke', () => oauth.revoke());
ipcMain.handle('oauth:configured', () => oauth.configured());
