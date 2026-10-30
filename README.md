# PrintCaddy for Windows

The desktop (Electron, 64-bit) edition of [PrintCaddy](https://rrkennedy69.github.io/), a browser 3D design tool for 3D printing.

**Download:** [latest installer](https://github.com/rrkennedy69/printcaddy-desktop/releases/latest) — run `PrintCaddy-Setup-x.y.z.exe`.
The installer is not code-signed, so Windows SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.

## What's different from the website
- Saves, opens and exports (.lyl, STL, 3MF) to any folder with normal Windows dialogs; remembers the last folder and lists recent files on the start page. Double-clicking a .lyl opens it.
- Larger models: up to ~5 million triangles per object saved in a design (web: 3.3M); boolean (hole/combine) default 1M triangles per object, adjustable up to 20M (web: 250k / 5M).
- Google Drive backup/restore/autosave uses the same Drive app-data files as the website (sign-in happens in your browser).
- "Check for updates" on the start page. Updates download in the background and the app asks to restart.

## Build
```
npm ci
npm run fetch-web      # web build pinned in web-commit.txt
npm start              # run
npx electron-builder --win nsis --x64
```
Releases are built by `.github/workflows/release.yml` on Windows when a `v*` tag is pushed.
Google sign-in needs a Desktop OAuth client: repo secrets `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET`, or `%APPDATA%\PrintCaddy\oauth-client.json`.

## License
AGPL-3.0-only. Based on layerling — see NOTICE.md. Web source: https://rrkennedy69.github.io/source-index.html
