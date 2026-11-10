import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const url = "http://127.0.0.1:3001/";

async function main() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    if (response.ok && /<title>Your Tech Lab<\/title>/.test(html)) {
      console.log(`Your Tech Lab is already running. Open: ${url}`);
      return;
    }
    throw new Error(`Port 3001 is in use but did not return Your Tech Lab. Check ${url} before starting another server.`);
  } catch (error) {
    if (error.cause?.code !== "ECONNREFUSED") throw error;
  }

  for (const name of ["copy-pc-assets.mjs", "copy-runtime-assets.mjs"]) {
    const result = spawnSync(process.execPath, [join(root, "scripts", name)], {
      cwd: root, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Preparing local assets failed: ${name}`);
  }

  console.log(`Starting Your Tech Lab. Keep this terminal open. Website: ${url}`);
  const child = spawn(process.execPath, [
    join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack",
    "--hostname", "127.0.0.1", "--port", "3001",
  ], {
    cwd: join(root, "apps/web"),
    stdio: "inherit",
    env: {
      ...process.env,
      WATCHPACK_POLLING: "true",
      SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE || join(realpathSync(tmpdir()), "ytl-swc-native"),
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 0 : 1); });
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
