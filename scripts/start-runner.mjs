// Use already-installed toolchains without changing the owner's global shell settings.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, RUNNER_SANDBOX: "required" };
if (!env.RUNNER_JAVA_HOME && process.platform === "darwin") {
  for (const base of ["/opt/homebrew", "/usr/local"]) {
    const home = `${base}/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`;
    if (existsSync(`${home}/bin/javac`)) { env.RUNNER_JAVA_HOME = home; break; }
  }
}
const child = spawn(process.execPath, ["services/runner/src/main.ts"], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", () => { console.error("The language runner could not start."); process.exit(1); });
