// TypeScript: the whole project is type-checked by the real compiler in a worker; only a project
// without type errors is emitted to JavaScript and run, through the same sandbox as JavaScript.
import { finishWithCompileErrors, runJavaScriptModules } from "./javascript";
import { pickEntry } from "./modules";
import { createRun } from "./run";
import { createSourceMapLookup, type SourceMapLookup } from "./sourcemap";
import type { FrameMapper } from "./stack";
import { isTypeScriptFile, type TsCheckResult, type TsSourceFile } from "./ts-check";
import type { RunAdapter, RuntimeLimits } from "./types";
import type { TsWorkerRequest, TsWorkerResponse } from "./typescript.worker";

export const TYPESCRIPT_ASSET_PATH = "/runtime/typescript/";
/** Download of the compiler plus the check itself. */
const CHECK_TIMEOUT_MS = 60_000;

/** Type-checks a project. Rejects when the checker cannot be loaded or does not answer. */
export type TypeChecker = (files: TsSourceFile[], signal: AbortSignal) => Promise<TsCheckResult>;

/** The checker in its worker. One worker is kept between runs, because loading the compiler is the slow part. */
export function createWorkerTypeChecker(origin: () => string = () => window.location.origin): TypeChecker {
  let worker: Worker | null = null;
  let nextId = 1;

  return (files, signal) =>
    new Promise<TsCheckResult>((resolve, reject) => {
      // A classic worker (no `type: "module"`): the compiler is loaded with importScripts.
      worker ??= new Worker(new URL("./typescript.worker.ts", import.meta.url));
      const current = worker;
      const id = nextId++;

      const cleanup = () => {
        clearTimeout(timer);
        current.removeEventListener("message", onMessage);
        current.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      /** A worker that failed or was abandoned mid-check is not reused. */
      const discard = (reason: Error) => {
        cleanup();
        current.terminate();
        if (worker === current) worker = null;
        reject(reason);
      };
      const onMessage = (event: MessageEvent<TsWorkerResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.message));
      };
      const onError = (event: ErrorEvent) => discard(new Error(event.message || "the type checker failed to start"));
      const onAbort = () => discard(new Error("stopped"));
      const timer = setTimeout(() => discard(new Error("the type checker did not answer in time")), CHECK_TIMEOUT_MS);

      current.addEventListener("message", onMessage);
      current.addEventListener("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      const request: TsWorkerRequest = { id, assetBase: `${origin()}${TYPESCRIPT_ASSET_PATH}`, files };
      current.postMessage(request);
    });
}

export function createTypeScriptAdapter(limits: RuntimeLimits, check: TypeChecker = createWorkerTypeChecker()): RunAdapter {
  return (request, context) =>
    createRun(request, async (control) => {
      const files = [...request.files].sort((a, b) => a.order - b.order).map((file) => ({ path: file.name, source: file.content }));
      const entryTs = pickEntry(files.map((file) => file.path).filter(isTypeScriptFile), ["main.ts", "index.ts"], [".ts", ".mts"]);
      if (entryTs === null) {
        finishWithCompileErrors(control, [{ severity: "error", message: "This project has no TypeScript file to run.", source: "compiler" }], 0);
        return;
      }

      control.setStatus("compiling");
      const abort = new AbortController();
      control.onStop(() => {
        abort.abort();
        control.finish({ status: "cancelled", phase: "compile" });
      });
      const loading = (value: boolean) => {
        try {
          context?.onRuntimeLoading?.(value);
        } catch (error) {
          console.error(error);
        }
      };

      const startedAt = performance.now();
      let checked: TsCheckResult;
      loading(true);
      try {
        checked = await check(files, abort.signal);
      } catch (error) {
        // No checker, no run: executing unchecked TypeScript would only be transpiling.
        control.finish({
          status: "runner_unavailable",
          phase: null,
          unavailableReason: "toolchain_not_installed",
          message: `The TypeScript checker could not be used: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      } finally {
        loading(false);
      }
      if (control.finished()) return;
      const compileMs = performance.now() - startedAt;

      if (checked.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        finishWithCompileErrors(control, checked.diagnostics, compileMs);
        return;
      }

      // Runtime errors point into the emitted JavaScript; map them back to the TypeScript the learner wrote.
      const lookups = new Map<string, { from: string; lookup: SourceMapLookup }>(
        checked.emitted.map((module) => [module.path, { from: module.from, lookup: createSourceMapLookup(module.map) }]),
      );
      const mapFrame: FrameMapper = (frame) => {
        const entry = lookups.get(frame.file);
        const original = entry?.lookup(frame.line, frame.column);
        return entry && original ? { file: entry.from, line: original.line, column: original.column } : null;
      };

      await runJavaScriptModules({
        control,
        context,
        limits,
        modules: checked.emitted.map((module) => ({ path: module.path, source: module.source })),
        entry: entryTs.replace(/\.(ts|mts)$/i, ".js"),
        stdin: request.stdin ?? "",
        compile: { ms: compileMs, diagnostics: checked.diagnostics },
        mapFrame,
      });
    });
}
