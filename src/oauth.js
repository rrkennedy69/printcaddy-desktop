'use strict';
// Google sign-in for the desktop app: OAuth 2.0 loopback flow with PKCE in the system browser
// (https://developers.google.com/identity/protocols/oauth2/native-app). Needs a "Desktop app"
// OAuth client in the SAME Google Cloud project as the website (va-to-z-513104) so both see
// the same Drive appDataFolder files. Client config, first found wins:
//   env PRINTCADDY_GOOGLE_CLIENT_ID / PRINTCADDY_GOOGLE_CLIENT_SECRET
//   %APPDATA%/PrintCaddy/oauth-client.json   {"client_id": "...", "client_secret": "..."}
//   <app>/src/oauth-client.json (bundled at build time)
const { app, shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

function config() {
  if (process.env.PRINTCADDY_GOOGLE_CLIENT_ID) return { client_id: process.env.PRINTCADDY_GOOGLE_CLIENT_ID, client_secret: process.env.PRINTCADDY_GOOGLE_CLIENT_SECRET || '' };
  for (const f of [path.join(app.getPath('userData'), 'oauth-client.json'), path.join(__dirname, 'oauth-client.json')]) {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); const c = j.installed || j; if (c.client_id && !/REPLACE/.test(c.client_id)) return { client_id: c.client_id, client_secret: c.client_secret || '' }; } catch {}
  }
  return null;
}
const TOKFILE = () => path.join(app.getPath('userData'), 'google-token.bin');
function saveRefresh(rt) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(rt) : Buffer.from('plain:' + rt);
  fs.writeFileSync(TOKFILE(), data);
}
function loadRefresh() {
  try { const b = fs.readFileSync(TOKFILE()); const s = b.toString(); if (s.startsWith('plain:')) return s.slice(6); return safeStorage.decryptString(b); } catch { return null; }
}
let cache = { token: null, exp: 0 }; let inflight = null;
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json(); if (!r.ok) { const e = new Error(j.error_description || j.error || 'token error'); e.code = j.error; throw e; }
  return j;
}
async function refresh(c) {
  const rt = loadRefresh(); if (!rt) return null;
  try {
    const j = await tokenRequest({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: rt, grant_type: 'refresh_token' });
    return j;
  } catch (e) { if (e.code === 'invalid_grant') try { fs.unlinkSync(TOKFILE()); } catch {} return null; }
}
function interactive(c, hint) {
  return new Promise((resolve, reject) => {
    const verifier = b64u(crypto.randomBytes(48)); const challenge = b64u(crypto.createHash('sha256').update(verifier).digest()); const state = b64u(crypto.randomBytes(16));
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset=utf-8><title>PrintCaddy</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>${msg}</h2><p>You can close this tab and return to PrintCaddy.</p>`); srv.close(); };
      if (u.searchParams.get('state') !== state) { done('Sign-in failed (state mismatch).'); return reject(new Error('state mismatch')); }
      const code = u.searchParams.get('code'); if (!code) { done('Sign-in cancelled.'); return reject(new Error(u.searchParams.get('error') || 'Sign-in cancelled')); }
      try {
        const port = srv.address().port;
        const j = await tokenRequest({ client_id: c.client_id, client_secret: c.client_secret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${port}/callback` });
        if (j.refresh_token) saveRefresh(j.refresh_token);
        done('Signed in to Google Drive.'); resolve(j);
      } catch (e) { done('Sign-in failed: ' + e.message); reject(e); }
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: `http://127.0.0.1:${port}/callback`, response_type: 'code', scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
      if (hint) q.set('login_hint', hint);
      shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    });
    setTimeout(() => { try { srv.close(); } catch {} reject(new Error('Sign-in timed out')); }, 5 * 60 * 1000);
  });
}
async function getToken({ interactive: allowUI, hint }) {
  const c = config(); if (!c) return { error: 'not_configured' };
  if (cache.token && Date.now() < cache.exp) return { access_token: cache.token, expires_in: Math.round((cache.exp - Date.now()) / 1000) };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      let j = await refresh(c);
      if (!j && allowUI) j = await interactive(c, hint);
      if (!j) return { error: 'interaction_required' };
      cache = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
      return { access_token: j.access_token, expires_in: j.expires_in || 3600, scope: SCOPE, token_type: 'Bearer' };
    } catch (e) { return { error: e.message || 'sign-in failed' }; } finally { inflight = null; }
  })();
  return inflight;
}
async function revoke() {
  const rt = loadRefresh(); cache = { token: null, exp: 0 };
  try { fs.unlinkSync(TOKFILE()); } catch {}
  if (rt) try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }); } catch {}
  return true;
}
module.exports = { getToken, revoke, configured: () => !!config() };
