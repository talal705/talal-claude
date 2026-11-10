// Run adapters for every track, behind one interface. Browser-only at call time; importing this
// module during server rendering is safe (nothing is created until an adapter is called).
//
//   javascript, typescript, python, html_css  run in the browser, inside a sandboxed frame
//   cpp, java, csharp                         run on the server through /api/execute
import { RUNTIME_CONFIGS, type CodeTrack } from "@ytl/contracts";
import { createPreviewAdapter, isHtmlFile } from "./html";
import { createJavaScriptAdapter } from "./javascript";
import { createPythonAdapter } from "./python";
import { createServerAdapter, type ServerAdapterOptions } from "./server";
import { createTypeScriptAdapter } from "./typescript";
import type { RunAdapter, RuntimeLimits } from "./types";

export type { OutputChunk, RunAdapter, RunContext, RunHandle, RuntimeLimits } from "./types";

function limitsFor(track: CodeTrack): RuntimeLimits {
  return { timeoutMs: RUNTIME_CONFIGS[track].timeoutMs, maxOutputBytes: RUNTIME_CONFIGS[track].maxOutputBytes };
}

export interface RunAdapterOptions {
  server?: ServerAdapterOptions;
}

/** One adapter per track. Register each with the workspace's `registerRunAdapter`. */
export function createRunAdapters(options: RunAdapterOptions = {}): Record<CodeTrack, RunAdapter> {
  // A page has no time limit (it is shown until stopped); its console output is still capped.
  const preview = createPreviewAdapter({ timeoutMs: 0, maxOutputBytes: RUNTIME_CONFIGS.javascript.maxOutputBytes });
  const javascriptConsole = createJavaScriptAdapter(limitsFor("javascript"));
  const server = createServerAdapter(options.server);
  return {
    html_css: preview,
    // A JavaScript project with a page is a DOM project and is shown in the preview; otherwise it is a console program.
    javascript: (request, context) => (request.files.some((file) => isHtmlFile(file.name)) ? preview : javascriptConsole)(request, context),
    typescript: createTypeScriptAdapter(limitsFor("typescript")),
    python: createPythonAdapter(limitsFor("python")),
    cpp: server,
    java: server,
    csharp: server,
  };
}
