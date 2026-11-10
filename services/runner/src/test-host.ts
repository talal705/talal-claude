// Test support: the runner tests execute real programs, so they need a C++ compiler and the process
// sandbox. On a host without them the suites are skipped with one loud line instead of failing.
import { CppAdapter } from "./adapters/cpp.ts";
import { detectSandbox } from "./sandbox.ts";

export interface TestHost {
  ok: boolean;
  /** Why the suites are skipped; also used as the skipped suite's name. */
  skipMessage: string;
}

export async function detectTestHost(): Promise<TestHost> {
  const [compiler, sandbox] = await Promise.all([new CppAdapter().detect(), detectSandbox()]);
  const missing = [
    compiler.available ? null : `no C++ compiler (${compiler.detail})`,
    sandbox.available ? null : `no process sandbox (${sandbox.detail})`,
  ].filter(Boolean);
  if (missing.length === 0) return { ok: true, skipMessage: "" };
  const skipMessage = `SKIPPED: runner tests did not run on this host: ${missing.join("; ")}.`;
  // Written straight to stderr: the default reporter hides console output and skipped suite names.
  process.stderr.write(`\n${skipMessage}\n`);
  return { ok: false, skipMessage };
}
