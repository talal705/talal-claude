// HTML/CSS pages (and JavaScript projects that have a page): a live preview in a sandboxed frame.
// The learner's page is rewritten before it is shown: the project's own stylesheets and scripts are
// placed inline (the frame cannot fetch anything), and a policy plus a small bootstrap go first.
import type { CodeDiagnostic } from "@ytl/contracts";
import { buildModulePlan, pickEntry, type ModuleFile, type ModulePlan } from "./modules";
import { OutputCollector } from "./output";
import { createRun } from "./run";
import { formatDiagnostics } from "./result";
import { newNonce, openSandbox } from "./sandbox-frame";
import { previewBootstrap } from "./sandbox-sources";
import type { SandboxMessage } from "./protocol";
import { describeRuntimeError } from "./stack";
import { blockedJourney, forwardTrainingRequest, isTrainingPath } from "./training";
import type { TrainingJourney } from "../server/training/contract";

/** Training requests of one preview waiting for an answer at the same time. */
const MAX_TRAINING_IN_FLIGHT = 8;
import type { RunAdapter, RuntimeLimits } from "./types";

// Inline and blob: scripts and inline styles only. No address is allowed for any kind of request,
// so the page cannot load from or send to the network; images and fonts must be data: URLs.
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

/** True for a reference that leaves the project: a scheme (`https:`, `data:`), or `//host`. */
function isExternal(reference: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//");
}

/** Project file a page refers to (`styles.css`, `./js/app.js`, `/img/logo.svg`), or null. */
export function resolveAsset(reference: string, page: string, paths: ReadonlySet<string>): string | null {
  const clean = reference.split(/[?#]/)[0];
  if (clean === "" || isExternal(clean)) return null;
  const relative = clean.startsWith("/") || clean.startsWith("./") || clean.startsWith("../") ? clean : `./${clean}`;
  const base = relative.startsWith("/") ? [] : page.split("/").slice(0, -1);
  const out: string[] = [];
  for (const segment of [...base, ...relative.split("/")]) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  const target = out.join("/");
  return paths.has(target) ? target : null;
}

/** Text placed inside a <script> element must not contain its end tag. */
function scriptSafe(source: string): string {
  return source.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/** An inline script that links a module plan into blob URLs inside the page and imports the entry. */
function moduleLoader(plan: ModulePlan): string {
  // "<" is escaped so that no file content can close the script element.
  const data = JSON.stringify(plan).replace(/</g, "\\u003c");
  return `(function () {
  var plan = ${data}, urls = {};
  plan.modules.forEach(function (module) {
    var source = module.chunks.map(function (chunk) { return typeof chunk === "string" ? chunk : JSON.stringify(urls[chunk.dep]); }).join("");
    urls[module.path] = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  });
  import(urls[plan.entry]).catch(function (error) { console.error(error); });
})();`;
}

export interface PreviewDocument {
  html: string;
  /** Things the page asked for that the preview does not provide. */
  diagnostics: CodeDiagnostic[];
}

/**
 * Builds the document shown in the preview frame. Needs a browser (DOMParser). The parsed copy is
 * inert: nothing in it runs or loads until the result is given to the sandboxed frame.
 */
export async function buildPreviewDocument(files: readonly ModuleFile[], page: string, nonce: string): Promise<PreviewDocument> {
  const sources = new Map(files.map((file) => [file.path, file.source]));
  const paths = new Set(sources.keys());
  const diagnostics: CodeDiagnostic[] = [];
  const note = (severity: CodeDiagnostic["severity"], message: string) => diagnostics.push({ severity, message, file: page, source: "compiler" });
  const doc = new DOMParser().parseFromString(sources.get(page) ?? "", "text/html");

  // The preview's own policy is the only one, and relative addresses must not be re-based.
  doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i], base').forEach((element) => element.remove());

  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet" i][href]'))) {
    const href = link.getAttribute("href") ?? "";
    const target = resolveAsset(href, page, paths);
    if (target === null) {
      note("warning", isExternal(href) ? `The stylesheet "${href}" is on another site; the preview has no network access.` : `The stylesheet "${href}" is not a file of this project.`);
      link.remove();
      continue;
    }
    const style = doc.createElement("style");
    const media = link.getAttribute("media");
    if (media) style.setAttribute("media", media);
    style.textContent = (sources.get(target) ?? "").replace(/<\/(style)/gi, "<\\/$1");
    link.replaceWith(style);
  }

  for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const src = script.getAttribute("src") ?? "";
    const target = resolveAsset(src, page, paths);
    if (target === null) {
      note("warning", isExternal(src) ? `The script "${src}" is on another site; the preview has no network access.` : `The script "${src}" is not a file of this project.`);
      script.remove();
      continue;
    }
    script.removeAttribute("src");
    if ((script.getAttribute("type") ?? "").toLowerCase() === "module") {
      // A module can import other files of the project; link them the same way as a console program.
      const planned = await buildModulePlan(files.filter((file) => /\.m?js$/i.test(file.path)), target);
      if (!planned.ok) {
        diagnostics.push(...planned.diagnostics);
        script.remove();
        continue;
      }
      script.removeAttribute("type");
      script.textContent = moduleLoader(planned.plan);
    } else {
      script.textContent = scriptSafe(sources.get(target) ?? "");
    }
  }

  for (const image of Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]"))) {
    const src = image.getAttribute("src") ?? "";
    if (src.startsWith("data:")) continue;
    const target = resolveAsset(src, page, paths);
    if (target !== null && /\.svg$/i.test(target)) {
      image.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sources.get(target) ?? "")}`);
    } else {
      note("warning", `The image "${src}" cannot be shown: the preview has no network access and a project holds text files only.`);
    }
  }

  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", PREVIEW_CSP);
  const bootstrap = doc.createElement("script");
  bootstrap.textContent = scriptSafe(previewBootstrap(nonce));
  // First in the head, in this order: the policy applies to everything after it.
  doc.head.prepend(csp, bootstrap);

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, diagnostics };
}

/**
 * The run stays `running` while the page is shown and ends when it is stopped. Console output and
 * page errors are reported live through `onOutput` and collected in the final result.
 */
export function createPreviewAdapter(limits: RuntimeLimits): RunAdapter {
  return (request, context) =>
    createRun(request, async (control) => {
      const container = context?.previewContainer;
      if (!container) {
        control.finish({
          status: "runner_unavailable",
          phase: null,
          unavailableReason: "internal_error",
          message: "A page preview needs RunContext.previewContainer.",
        });
        return;
      }
      const files = [...request.files].sort((a, b) => a.order - b.order).map((file) => ({ path: file.name, source: file.content }));
      const page = pickEntry(files.map((file) => file.path), ["index.html"], [".html", ".htm"]);
      if (page === null) {
        const diagnostics: CodeDiagnostic[] = [{ severity: "error", message: "This project has no HTML page to show.", source: "compiler" }];
        control.finish({ status: "error", phase: "compile", diagnostics, compilerOutput: "error: This project has no HTML page to show." });
        return;
      }

      control.setStatus("compiling");
      const output = new OutputCollector(limits.maxOutputBytes, context?.onOutput);
      let shownAt: number | null = null;
      // Stop while the page is still being prepared: nothing has been shown.
      control.onStop(() => control.finish({ status: "cancelled", phase: null }));

      const nonce = newNonce();
      const built = await buildPreviewDocument(files, page, nonce);
      if (control.finished()) return;
      const diagnostics = built.diagnostics;
      if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        control.finish({ status: "error", phase: "compile", diagnostics, compilerOutput: formatDiagnostics(diagnostics) });
        return;
      }
      const finish = (status: "cancelled" | "error" | "output_limit") =>
        control.finish({
          status,
          phase: "run",
          output,
          diagnostics,
          compilerOutput: formatDiagnostics(built.diagnostics),
          runMs: shownAt === null ? 0 : performance.now() - shownAt,
        });

      const sandbox = openSandbox({
        executionId: control.executionId,
        title: "Page preview",
        container,
        nonce,
        srcdoc: built.html,
        onNavigated: () => {
          output.append("stderr", "The page left the preview (it navigated to another address), so the preview was closed.\n");
          finish("error");
        },
        onMessage: (message) => {
          if (control.finished()) return;
          if (message.type === "ready") {
            shownAt = performance.now();
            control.setStatus("running");
          } else if (message.type === "output") {
            if (!output.append(message.stream, message.text)) finish("output_limit");
          } else if (message.type === "error") {
            const report = describeRuntimeError(message);
            diagnostics.push(report.diagnostic);
            if (!output.append("stderr", report.text)) finish("output_limit");
          } else if (message.type === "api_request" || message.type === "api_blocked") {
            handleTraining(message);
          }
        },
      });

      // ---- "How websites work": the page's fetch() of a training path, forwarded to the training API ----
      const training = context?.training;
      let requestNumber = 0;
      let inFlight = 0;
      const journey = (value: TrainingJourney) => {
        try {
          training?.onJourney?.(value);
        } catch (error) {
          console.error(error);
        }
      };
      const handleTraining = (message: Extract<SandboxMessage, { type: "api_request" | "api_blocked" }>) => {
        requestNumber += 1;
        if (message.type === "api_blocked") {
          journey(blockedJourney(control.executionId, requestNumber, message.url));
          return;
        }
        const refuse = (text: string) => sandbox.send({ type: "api_failure", requestId: message.requestId, message: text });
        if (!training) return refuse("This project has no training API.");
        if (!isTrainingPath(message.path)) {
          journey(blockedJourney(control.executionId, requestNumber, message.path));
          return refuse("The preview can only reach this project's training API (paths that start with /api/).");
        }
        if (inFlight >= MAX_TRAINING_IN_FLIGHT) return refuse("Too many requests at once; wait for the answers.");
        inFlight += 1;
        const forward = { projectId: training.projectId, runId: control.executionId, requestNumber, method: message.method, path: message.path, body: message.body };
        void forwardTrainingRequest(forward).then((outcome) => {
          inFlight -= 1;
          if (control.finished()) return;
          journey(outcome.journey);
          if (outcome.ok) sandbox.send({ type: "api_response", requestId: message.requestId, status: outcome.status, body: outcome.body });
          else refuse(outcome.message);
        });
      };
      control.onEnd(() => sandbox.dispose());
      control.onStop(() => finish("cancelled"));
    });
}
