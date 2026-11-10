// Python programs on Pyodide, in a worker inside the sandbox. Pyodide's files come from this
// site's own /runtime/pyodide/ (copied there by scripts/copy-runtime-assets.mjs); the sandbox's
// policy allows no other address, so nothing is fetched from a CDN.
import { pickEntry } from "./modules";
import { runInSandbox } from "./program";
import { parsePythonTraceback } from "./python-traceback";
import { createRun } from "./run";
import { PYTHON_WORKER_SOURCE } from "./sandbox-sources";
import type { RunAdapter, RuntimeLimits } from "./types";

export const PYODIDE_ASSET_PATH = "/runtime/pyodide/";

/**
 * Scripts and connections only to the Pyodide directory of `origin`. Pyodide compiles WebAssembly
 * and evaluates generated JavaScript, hence 'wasm-unsafe-eval' and 'unsafe-eval'; inside an
 * opaque-origin frame without network they grant nothing a learner's program does not already have.
 */
export function pythonSandboxCsp(origin: string): string {
  const assets = `${origin}${PYODIDE_ASSET_PATH}`;
  return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${assets}; worker-src blob:; connect-src ${assets}`;
}

export function createPythonAdapter(limits: RuntimeLimits, origin: () => string = () => window.location.origin): RunAdapter {
  return (request, context) =>
    createRun(request, (control) => {
      const files = [...request.files].sort((a, b) => a.order - b.order).map((file) => ({ path: file.name, content: file.content }));
      const entry = pickEntry(files.map((file) => file.path), ["main.py"], [".py"]);
      if (entry === null) {
        control.finish({
          status: "error",
          phase: "compile",
          diagnostics: [{ severity: "error", message: "This project has no Python file to run.", source: "compiler" }],
          compilerOutput: "error: This project has no Python file to run.",
        });
        return;
      }
      // Shown as "compiling" while the interpreter is downloaded and started.
      control.setStatus("compiling");
      runInSandbox({
        control,
        context,
        limits,
        csp: pythonSandboxCsp(origin()),
        workerSource: PYTHON_WORKER_SOURCE,
        workerType: "classic",
        init: { assetBase: `${origin()}${PYODIDE_ASSET_PATH}`, files, entry, stdin: request.stdin ?? "" },
        title: "Python sandbox",
        diagnoseStderr: parsePythonTraceback,
        // The first run downloads about 12 MB.
        startTimeoutMs: 90_000,
        // Pyodide's files are not on this server, or could not be loaded.
        startFailureReason: "toolchain_not_installed",
      });
    });
}
