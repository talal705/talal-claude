# Browser run adapters

`createRunAdapters()` (from `@/lib/runtime`) returns one run adapter per track. Each takes an
`ExecutionRequest` and returns a handle with a status, a `result` promise that always resolves with
the frozen `ExecutionResult`, and `stop()`.

| Track | Where it runs | How |
|---|---|---|
| JavaScript | Browser | ES modules in a Worker, inside a sandboxed frame |
| TypeScript | Browser | Type-checked by the real compiler in a Worker, then run as JavaScript |
| Python | Browser | Pyodide (CPython compiled to WebAssembly) in a Worker, inside a sandboxed frame |
| HTML/CSS, and JavaScript projects with a page | Browser | Live preview in a sandboxed frame |
| C++, Java, C# | Server | `/api/execute`, which calls the runner service (`services/runner`) |

## The sandbox

Learner code never runs in the application's page or on its origin.

- Every run gets a new `<iframe sandbox="allow-scripts">` filled from `srcdoc`. Without
  `allow-same-origin` the frame has an opaque origin: no cookies, no `localStorage` or IndexedDB of
  this site, no access to the parent page, and requests to `/api/*` carry no session.
- The frame's document starts with a Content-Security-Policy. For JavaScript and previews it allows
  inline and `blob:` scripts and nothing else, so `fetch`, WebSocket, external scripts, stylesheets
  and images are all refused. For Python it additionally allows this site's `/runtime/pyodide/`
  path, where the interpreter is served from; no other address, so nothing comes from a CDN.
- Console programs run in a Worker that the frame creates, so an endless loop does not freeze the page.
- The page and the frame talk over one `MessageChannel` created for that frame and that run. The
  frame accepts the channel only from its parent window and only with a random value embedded in its
  own document. Every message from the sandbox is validated (`protocol.ts`: exact shape, this run's
  execution ID, size limit) and treated as text.
- Stop, the time limit and the output cap all work the same way: the frame is removed, and the
  browser ends its scripts and Workers.

The TypeScript checker is the exception to "inside a frame": it is the application's own code, runs
in a Worker on the application's origin, and only reads the learner's files as text.

## Per track

**JavaScript.** Files are linked as ES modules: every `import` is resolved to a project file
(`./util.js`, `./util`, a folder's `index.js`) and the modules are loaded from `blob:` URLs. Only
project files can be imported; packages, URLs and circular imports are reported as compile-phase
errors with file and line. `console.*` is captured. `readLine()` returns the next line of the
stdin given before the run, then `null`. The run ends when the entry module has finished and no
timer is pending. An uncaught error is reported with the project file and line.

**TypeScript.** `typescript@6.0.3` (the JavaScript-based compiler, loaded from
`/runtime/typescript/`) type-checks the whole project with `strict` on, against the ES2022 and
Web Worker libraries. Any error ends the run in the compile phase with file, line, column and
range; nothing is executed. Only a clean project is emitted and run. Runtime errors are mapped back
to the `.ts` line through the source map.

**Python.** `pyodide@314.0.7`, standard library only (no numpy or other packages: they are separate
downloads this site does not host). Files are written to an in-memory file system, so a project's
own modules and packages import normally. `input()` reads the stdin given before the run and raises
`EOFError` at its end. An uncaught exception prints a traceback that names only project files, and
is reported with the file and line of the innermost project frame. The first run downloads about
12 MB; `onRuntimeLoading` reports that phase.

**HTML/CSS preview.** The page's own stylesheets and scripts are placed inline before it is shown,
because the frame cannot fetch anything. The run stays `running` until stopped. Console output and
page errors are reported. Not available: links to other pages and form submits (a console warning
says so), `alert` / `confirm` / `prompt` dialogs (they print to the console), images other than
`.svg` files of the project or `data:` URLs, and anything from the network.

## Limits, and what a browser cannot enforce

| Limit | Enforced by | Value |
|---|---|---|
| Run time (JavaScript, TypeScript, Python) | Timer in the page; the frame is removed | 10 s, 15 s, 30 s (`RUNTIME_CONFIGS`) |
| Output | Counted in the page as it arrives; the frame is removed at the cap | 1 MiB per stream |
| Network, storage, cookies, parent page | Sandbox attribute and Content-Security-Policy | none |

Not enforced:

- **Memory.** A page cannot set a memory ceiling for a frame or a Worker. A program that allocates
  without end is stopped by the browser itself (the tab's renderer may be killed), or by the time
  limit, whichever comes first. This cannot be made a clean `memory_limit` result.
- **CPU.** A program can use a full core for its time limit; a page cannot lower its priority.
- **A page preview has no time limit and runs on the frame's main thread.** Whether an endless loop
  in a preview freezes only the frame or the whole tab depends on whether the browser puts the
  sandboxed frame in its own process. Chromium does on desktop; this is not guaranteed elsewhere.
  Stop works only if the tab still responds.
- **Navigation.** The policy cannot stop a preview page from navigating its own frame by script.
  When that happens the run ends with an error, and nothing is ever sent to the new document.
- **Exact timing.** Browsers throttle timers in background tabs, so a time limit can fire late there.
- **Precision of the "program has ended" signal for JavaScript.** Pending timers are tracked; other
  pending work (an unresolved promise nobody awaits) is not, so such a program ends when its entry
  module does.

## Assets

`scripts/copy-runtime-assets.mjs` copies the TypeScript compiler with its `lib*.d.ts` files and the
Pyodide files into `apps/web/public/runtime/` before `dev` and `build`. `/runtime/*` is served with
`Access-Control-Allow-Origin: *`, which the opaque-origin frame needs to fetch Pyodide's files.

## Tests

- `npm test` covers what needs no browser: module linking (the linked modules are really loaded),
  the message protocol, output cap, result shape, run life cycle, stack and traceback parsing,
  source maps, the real TypeScript compiler on real projects, the real Pyodide interpreter under
  Node, and the JavaScript worker's own source in a Node worker thread.
- A browser is needed for the sandbox itself. `installRuntimeHarness()` (`harness.ts`) puts
  `window.__ytlRuntime` on a page: `runCase(name)`, `runAll({ server?, only? })`, `run(request)`,
  `openFrames()`, and `cases`, the list in `HARNESS_CASES` with the expected outcome of each.
