# Virtual Training Environment (VTE) — بيئة التدريب الافتراضية

An English/Arabic learning website by Talal: build a PC in an interactive 3D scene and explore programming with a small helper.

## Current PC experience

- Prepare the CPU, RAM, M.2 SSD and air cooler on the motherboard, then install the board in the case, GPU and PSU.
- Connect motherboard ATX, CPU EPS, GPU PCIe, CPU fan and case power-button cables. Two case fan leads are optional for boot and control their fan motion.
- Startup is checked by the simulation engine; missing required connections fail and can be corrected.
- Refined original educational procedural models, centred camera, English/Arabic and local progress saving.
- Two alternatives in the same lists: a second CPU (Intel Core i9-14900K) beside the Core i5-14600K, and a 280 mm all-in-one liquid cooler (ARCTIC Liquid Freezer III 280) beside the air cooler. One CPU and one cooler at a time. Coolers are fitted and removed step by step, one documented step per click; there is no one-click cooler swap, so the first cooler is taken off before the other goes on.
- The liquid cooler's pump block may be prepared on the CPU on the bench; its radiator waits until the board is in the case, then goes upright in the case's front 280 mm position (Corsair lists 240/280/360 mm there). That position covers the front fan places, so the two supplied case fans move to the top as exhaust while it is in. Its pump lead goes to AIO_PUMP and its radiator fan lead to CPU_FAN.
- Lab rule (educational, this CPU only): the Core i9-14900K starts only with the liquid cooler fitted and both of its leads connected. Otherwise Start shows the failure with a short fix in Arabic. It is not a real-world claim that every similar CPU needs liquid cooling.

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
