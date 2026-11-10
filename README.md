# Talal Claude — Your Tech Lab

An English/Arabic learning website by Talal: build a PC in an interactive 3D scene and explore programming with a small helper.

## Current PC experience

- Prepare the CPU, RAM, M.2 SSD and air cooler on the motherboard, then install the board in the case, GPU and PSU.
- Connect motherboard ATX, CPU EPS, GPU PCIe, CPU fan and case power-button cables. Two case fan leads are optional for boot and control their fan motion.
- Startup is checked by the simulation engine; missing required connections fail and can be corrected.
- Refined original educational procedural models, centred camera, English/Arabic and local progress saving.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev:local
```

Open http://127.0.0.1:3001/. Keep the terminal open. The VS Code project folder is the repository root.

## Checks

```sh
npm run type-check
npm run check:messages
npm test
```

## Deployment and limits

This repository contains source code. GitHub alone does not host the running application. The full application needs a Node.js server (Next.js), not GitHub Pages. Run `npm run build` then `npm run start` on a compatible host. Set a production `SESSION_SECRET` and the application's public origin there. Never commit actual environment files or API keys.

The AI tutor integration requires a server-side provider key and verification; built-in hints work without a provider. The separate C++/Java/C# runner uses macOS isolation and is not ready for public internet deployment; do not disable its isolation. Browser-side exercises and the PC simulation remain independent of that service. PostgreSQL is optional for guest use.

## About this source snapshot

This publication contains the current application, not the private local Git history or internal screenshot evidence. Original procedural models are educational approximations, not manufacturer CAD assets. Dependency licenses remain with their respective authors.
