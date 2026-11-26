// Vitest config that runs seed.test.ts: writes the seeded saves used by wiring-startup.mjs (VTE_SEED or <tmp>/vte-seed.json).
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export default {
  root,
  resolve: { alias: {
    vitest: `${root}/node_modules/vitest/dist/index.js`,
    "@ytl/contracts": `${root}/packages/contracts/src/index.ts`,
    "@ytl/simulation": `${root}/packages/simulation/src/index.ts`,
    "@ytl/curriculum": `${root}/packages/curriculum/src/index.ts`,
    "@ytl/catalog": `${root}/content/catalog/index.ts`,
  } },
  test: { include: ["docs/handoff/2026-11-26/acceptance/seed.test.ts"] },
};
