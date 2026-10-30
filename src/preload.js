'use strict';
// Bridges for the PrintCaddy web build: desktop info, files, updates, and a Google Identity
// Services shim so the existing Drive sync (gdrive-sync.js) works with the loopback OAuth flow.
const { contextBridge, ipcRenderer, webFrame } = require('electron');
const fs = require('fs'); const path = require('path');

contextBridge.exposeInMainWorld('printcaddyDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  recent: () => ipcRenderer.invoke('desktop:recent'),
  openDialog: () => ipcRenderer.invoke('desktop:open-dialog'),
  readFile: (f) => ipcRenderer.invoke('desktop:read-file', f),
  saveAs: (name, bytes, filters) => ipcRenderer.invoke('desktop:save-as', { name, bytes, filters }),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  googleConfigured: () => ipcRenderer.invoke('oauth:configured'),
});

// --- google.accounts.oauth2 shim (only the parts gdrive-sync.js uses) --------------------------
contextBridge.exposeInMainWorld('google', { accounts: { oauth2: {
  initTokenClient: (cfg) => ({
    requestAccessToken: (opts) => {
      const o = opts || {};
      const allowUI = o.prompt === 'consent' || (navigator.userActivation && navigator.userActivation.isActive);
      ipcRenderer.invoke('oauth:token', { interactive: !!allowUI, hint: o.login_hint || cfg.login_hint }).then((r) => {
        if (r && r.access_token) cfg.callback(r);
        else if (r && r.error === 'not_configured') (cfg.error_callback || cfg.callback)({ type: 'Google sign-in is not set up in this desktop build yet', error: 'not_configured' });
        else if (cfg.error_callback) cfg.error_callback({ type: (r && r.error) || 'popup_closed' }); else cfg.callback({ error: (r && r.error) || 'failed' });
      });
    },
  }),
  revoke: (_t, cb) => { ipcRenderer.invoke('oauth:revoke').then(() => cb && cb({ successful: true })); },
  hasGrantedAllScopes: () => true,
} } });

// --- Home screen "Desktop" section: updates + open/recent files ---------------------------------
const CSS = `#pcd-home{margin:16px 0;padding:14px 18px;border:1px solid #f0c68f;border-radius:14px;background:#fff7ec;font:14px system-ui,sans-serif;color:#3b2a16;display:flex;gap:24px;flex-wrap:wrap}
#pcd-home h3{margin:0 0 6px;font-size:15px}#pcd-home .col{flex:1 1 300px;min-width:260px}
#pcd-home button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #d9822b;background:#e98a2c;color:#fff;cursor:pointer;margin:4px 6px 4px 0}
#pcd-home button.sec{background:#fff;color:#a65812}#pcd-home ul{list-style:none;margin:4px 0;padding:0;max-height:150px;overflow:auto}
#pcd-home li a{color:#a65812;cursor:pointer;text-decoration:underline}#pcd-home li small{color:#8a7560;margin-left:6px}
#pcd-home .bar{height:6px;background:#f3dcc0;border-radius:3px;overflow:hidden;margin-top:6px}#pcd-home .bar i{display:block;height:100%;background:#e98a2c}`;
let upd = { status: 'idle' }; let info = null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function updText() {
  switch (upd.status) {
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return 'You have the latest version.';
    case 'downloading': return `Update ${esc(upd.version || '')} available - downloading in the background (${upd.progress || 0}%).`;
    case 'ready': return `<b>Update ${esc(upd.version)} is ready.</b>`;
    case 'error': return 'Could not check for updates: ' + esc(upd.error || '');
    case 'dev': return 'Development build - updates are checked in the installed app.';
    default: return 'Updates are checked automatically when PrintCaddy starts.';
  }
}
function openPath(f) {
  const go = `(async()=>{const r=await window.printcaddyDesktop.readFile(${JSON.stringify(f)});const file=new File([r.bytes],r.name);
    for(let i=0;i<60&&!(window.PrintCADApp&&window.PrintCADApp.importFiles);i++)await new Promise(s=>setTimeout(s,250));
    await window.PrintCADApp.importFiles([file]);})()`;
  if (location.pathname !== '/' && !/^\/(index\.html)?$/.test(location.pathname)) { sessionStorage.setItem('pcd-open', f); location.href = '/'; return; }
  webFrame.executeJavaScript(go).catch((e) => alert('Could not open ' + f + ': ' + e.message));
}
async function render() {
  const host = document.getElementById('pcd-home'); if (!host) return;
  const recent = await ipcRenderer.invoke('desktop:recent');
  host.innerHTML = `<div class="col"><h3>Check for updates</h3><div>PrintCaddy for Windows <b>v${esc(info ? info.version : '')}</b></div>
    <div id="pcd-upd" style="margin-top:4px">${updText()}</div>${upd.status === 'downloading' ? `<div class="bar"><i style="width:${upd.progress || 0}%"></i></div>` : ''}
    <button id="pcd-check" class="sec">Check for updates</button>${upd.status === 'ready' ? '<button id="pcd-restart">Restart now</button>' : ''}</div>
    <div class="col"><h3>Files on this computer</h3><button id="pcd-open">Open file…</button>
    <ul>${recent.length ? recent.map((f) => `<li><a data-f="${esc(f)}">${esc(path.basename(f))}</a><small>${esc(path.dirname(f))}</small></li>`).join('') : '<li><small>No recent files yet. Use Save in the editor to choose where designs go.</small></li>'}</ul></div>`;
  host.querySelector('#pcd-check').onclick = () => { upd = { status: 'checking' }; render(); ipcRenderer.invoke('updates:check'); };
  const rs = host.querySelector('#pcd-restart'); if (rs) rs.onclick = () => ipcRenderer.invoke('updates:install');
  host.querySelector('#pcd-open').onclick = async () => { const fs_ = await ipcRenderer.invoke('desktop:open-dialog'); if (fs_[0]) openPath(fs_[0]); };
  host.querySelectorAll('a[data-f]').forEach((a) => { a.onclick = () => openPath(a.dataset.f); });
}
function mount() {
  // The browser "Install as an app" banner makes no sense inside the desktop app.
  document.querySelectorAll('h2,h3,strong,b,p,div').forEach((el) => {
    if (el.childElementCount === 0 && /^Install (PrintCaddy|PrintCAD|layerling) as an app$/i.test((el.textContent || '').trim())) {
      let card = el; for (let i = 0; i < 6 && card.parentElement; i++) { card = card.parentElement; if (/Not now/.test(card.textContent || '')) break; }
      if (card && /Not now/.test(card.textContent || '')) card.style.display = 'none';
    }
  });
  if (document.getElementById('pcd-home')) return;
  const btn = [...document.querySelectorAll('button,a')].find((b) => /Create (a )?new 3D design/i.test(b.textContent || ''));
  if (!btn) return;
  const row = btn.closest('.dashboard-actions-band') || btn.parentElement;
  const sec = document.createElement('section'); sec.id = 'pcd-home'; sec.setAttribute('aria-label', 'PrintCaddy desktop');
  row.insertAdjacentElement('afterend', sec); render();
}
ipcRenderer.on('updates:state', (_e, s) => { upd = s; render(); });
ipcRenderer.on('desktop:recent-changed', () => render());
ipcRenderer.on('desktop:open-path', (_e, f) => openPath(f));
window.addEventListener('DOMContentLoaded', async () => {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  info = await ipcRenderer.invoke('desktop:info'); upd = await ipcRenderer.invoke('updates:state');
  new MutationObserver(() => mount()).observe(document.body, { childList: true, subtree: true }); mount();
  const pending = sessionStorage.getItem('pcd-open') || await ipcRenderer.invoke('desktop:pending-open');
  if (pending) { sessionStorage.removeItem('pcd-open'); setTimeout(() => openPath(pending), 1500); }
});
