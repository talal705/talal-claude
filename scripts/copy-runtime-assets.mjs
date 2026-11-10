// Browser runtimes are served locally. Never touch the PC model library here.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "apps/web/public/runtime");
const ts = join(root, "node_modules/typescript-js/lib");
mkdirSync(join(out, "typescript"), { recursive: true });
for (const name of readdirSync(ts)) {
  if (name === "typescript.js" || /^lib.*\.d\.ts$/.test(name)) cpSync(join(ts, name), join(out, "typescript", name));
}
mkdirSync(join(out, "pyodide"), { recursive: true });
for (const name of ["pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  cpSync(join(root, "node_modules/pyodide", name), join(out, "pyodide", name));
}
console.log("Local TypeScript and Python runtimes ready.");
