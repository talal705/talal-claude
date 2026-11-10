// Entry point: `node services/runner/src/main.ts` (Node 22.18+ runs TypeScript directly).
// Deliberately does not load .env.local: the runner needs no platform secret, so it is never given one.
import { configFromEnv } from "./config.ts";
import { createRunnerServer } from "./http.ts";
import { Runner } from "./runner.ts";

const host = process.env.RUNNER_HOST || "127.0.0.1";
const port = Number(process.env.RUNNER_PORT || 4000);
const token = process.env.RUNNER_TOKEN || undefined;

if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && !token) {
  console.error("runner: refusing to listen on a non-loopback address without RUNNER_TOKEN");
  process.exit(1);
}

const runner = await Runner.create(configFromEnv(process.env));
const server = createRunnerServer(runner, { token });

server.listen(port, host, () => {
  const health = runner.health();
  // The real port: RUNNER_PORT=0 asks the system for a free one.
  const address = server.address();
  console.log(`runner: listening on http://${host}:${typeof address === "object" && address ? address.port : port}`);
  for (const [track, status] of Object.entries(health.toolchains)) {
    console.log(`runner: ${track}: ${status.available ? `available (${status.version})` : `unavailable (${status.reason}: ${status.detail})`}`);
  }
  console.log(`runner: sandbox: ${health.sandbox.kind}${health.sandbox.required ? "" : " (NOT required: unsafe for learner code)"}`);
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  // Kills every job's process group and removes every workspace before exiting.
  await runner.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
