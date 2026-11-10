// Copies the generated PC part geometry and drawings (assets/pc, owned by the engineer) into
// apps/web/public/assets/pc/ so the 3D scene loads them from our own origin. Runs before `dev` and `build`.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "assets/pc");
const target = join(root, "apps/web/public/assets/pc");
rmSync(target, { recursive: true, force: true });
let files = 0;
if (existsSync(source)) {
  cpSync(source, target, { recursive: true });
  files = readdirSync(source, { recursive: true }).filter((f) => /\.(json|svg)$/.test(String(f))).length;
}
console.log(`pc assets: ${files} files -> apps/web/public/assets/pc/`);
