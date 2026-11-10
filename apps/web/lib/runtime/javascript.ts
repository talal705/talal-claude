// JavaScript console programs: linked into ES modules and run in a worker inside the sandbox.
import type { CodeDiagnostic, CodeFile } from "@ytl/contracts";
import { buildModulePlan, pickEntry, type ModuleFile } from "./modules";
import { runInSandbox } from "./program";
import { formatDiagnostics } from "./result";
import { createRun, type RunControl } from "./run";
import { JS_WORKER_SOURCE } from "./sandbox-sources";
import type { FrameMapper } from "./stack";
import type { RunAdapter, RunContext, RuntimeLimits } from "./types";

// Inline script for the frame's bootstrap, blob: for the worker and the modules. Nothing else:
// no network of any kind (connect-src falls back to default-src), no images, no frames.
export const JS_SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:";

const JS_EXTENSIONS = [".js", ".mjs"];

export function isJavaScriptFile(path: string): boolean {
  return JS_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

/** Ends the run with compile-phase errors (linking, type checking). Nothing has run. */
export function finishWithCompileErrors(control: RunControl, diagnostics: CodeDiagnostic[], compileMs: number): void {
  control.finish({ status: "error", phase: "compile", diagnostics, compilerOutput: formatDiagnostics(diagnostics), compileMs });
}

export interface JavaScriptProgram {
  control: RunControl;
  context?: RunContext;
  limits: RuntimeLimits;
  modules: ModuleFile[];
  entry: string;
  stdin: string;
  /** From an earlier step (type checking). */
  compile?: { ms: number; diagnostics: CodeDiagnostic[] };
  mapFrame?: FrameMapper;
}

/** Links the modules and starts them. Shared by the JavaScript and TypeScript adapters. */
export async function runJavaScriptModules(program: JavaScriptProgram): Promise<void> {
  const { control } = program;
  const linkStartedAt = performance.now();
  const planned = await buildModulePlan(program.modules, program.entry);
  const compileMs = (program.compile?.ms ?? 0) + (performance.now() - linkStartedAt);
  if (control.finished()) return;
  if (!planned.ok) {
    finishWithCompileErrors(control, [...(program.compile?.diagnostics ?? []), ...planned.diagnostics], compileMs);
    return;
  }
  const diagnostics = program.compile?.diagnostics ?? [];
  runInSandbox({
    control,
    context: program.context,
    limits: program.limits,
    csp: JS_SANDBOX_CSP,
    workerSource: JS_WORKER_SOURCE,
    // A classic worker that loads the modules with import(): browsers refuse to start a module
    // worker from a blob: URL inside an opaque-origin frame (checked in Chromium).
    workerType: "classic",
    init: { modules: planned.plan.modules, entry: planned.plan.entry, stdin: program.stdin },
    title: "Program sandbox",
    compile: { ms: compileMs, output: formatDiagnostics(diagnostics), diagnostics },
    mapFrame: program.mapFrame,
    startTimeoutMs: 15_000,
    startFailureReason: "internal_error",
  });
}

export function toModuleFiles(files: readonly CodeFile[], accept: (path: string) => boolean): ModuleFile[] {
  return [...files].sort((a, b) => a.order - b.order).filter((file) => accept(file.name)).map((file) => ({ path: file.name, source: file.content }));
}

export function createJavaScriptAdapter(limits: RuntimeLimits): RunAdapter {
  return (request, context) =>
    createRun(request, async (control) => {
      control.setStatus("compiling");
      const modules = toModuleFiles(request.files, isJavaScriptFile);
      const entry = pickEntry(modules.map((module) => module.path), ["main.js", "index.js"], JS_EXTENSIONS);
      if (entry === null) {
        finishWithCompileErrors(control, [{ severity: "error", message: "This project has no JavaScript file to run.", source: "compiler" }], 0);
        return;
      }
      await runJavaScriptModules({ control, context, limits, modules, entry, stdin: request.stdin ?? "" });
    });
}
