'use strict';
// Background updates from GitHub Releases (rrkennedy69/printcaddy-desktop) via electron-updater.
const { app, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
let win = null; let state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };
function send() { if (win && !win.isDestroyed()) win.webContents.send('updates:state', state); }
function set(p) { state = { ...state, ...p }; send(); }
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
autoUpdater.on('update-not-available', () => set({ status: 'up-to-date', checkedAt: Date.now() }));
autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, progress: 0, checkedAt: Date.now() }));
autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
autoUpdater.on('error', (e) => set({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
autoUpdater.on('update-downloaded', async (i) => {
  set({ status: 'ready', version: i.version, progress: 100 });
  if (!win) return;
  const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, title: 'PrintCaddy update',
    message: `Update ready - restart now?`, detail: `PrintCaddy ${i.version} has been downloaded. Restart to finish installing, or it installs the next time you close PrintCaddy.` });
  if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
});
async function check() {
  if (!app.isPackaged && !process.env.PRINTCADDY_UPDATE_TEST) { set({ status: 'dev', checkedAt: Date.now() }); return state; }
  try { await autoUpdater.checkForUpdates(); } catch (e) { set({ status: 'error', error: String(e.message || e).slice(0, 200) }); }
  return state;
}
ipcMain.handle('updates:check', () => check());
ipcMain.handle('updates:state', () => state);
ipcMain.handle('updates:install', () => { if (state.status === 'ready') autoUpdater.quitAndInstall(true, true); });
module.exports = { attach(w) { win = w; w.webContents.once('did-finish-load', () => setTimeout(check, 3000)); setInterval(check, 4 * 60 * 60 * 1000); } };
