// Links a multi-file JavaScript project into ES modules that can be loaded from blob URLs.
// This file only plans: it finds every import, resolves it to a project file and orders the modules
// so that each one comes after the modules it imports. The sandbox turns the plan into blob URLs.
import type { CodeDiagnostic } from "@ytl/contracts";
import { init, parse } from "es-module-lexer";

export interface ModuleFile {
  /** Project-relative path, e.g. `main.js` or `lib/math.js`. */
  path: string;
  source: string;
}

/** A module's source cut at its import specifiers; each `{ dep }` is replaced by that module's URL (quoted). */
export interface LinkedModule {
  path: string;
  chunks: (string | { dep: string })[];
}

export interface ModulePlan {
  entry: string;
  /** Only modules reachable from the entry, dependencies before dependents. */
  modules: LinkedModule[];
}

export type ModulePlanResult = { ok: true; plan: ModulePlan } | { ok: false; diagnostics: CodeDiagnostic[] };

/** 1-based line and column of a character offset. */
export function positionAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = source.indexOf("\n"); index !== -1 && index < offset; index = source.indexOf("\n", index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

function normalize(segments: string[]): string | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null; // Above the project root.
      out.pop();
    } else out.push(segment);
  }
  return out.join("/");
}

/**
 * Resolves a relative specifier against the importing file. Tries the path as written, then the
 * forms a learner coming from TypeScript or Node would write: `./util` and `./util.ts` for `util.js`,
 * and a folder's `index.js`. Returns null for anything that is not a file of the project.
 */
export function resolveSpecifier(specifier: string, importer: string, paths: ReadonlySet<string>): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) return null;
  const base = specifier.startsWith("/") ? [] : importer.split("/").slice(0, -1);
  const target = normalize([...base, ...specifier.split("/")]);
  if (target === null || target === "") return null;
  const candidates = [target, target.replace(/\.(ts|mts)$/, ".js"), `${target}.js`, `${target}.mjs`, `${target}/index.js`];
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

interface ParsedModule {
  path: string;
  chunks: (string | { dep: string })[];
  deps: string[];
}

function error(file: string, source: string, offset: number, message: string): CodeDiagnostic {
  return { severity: "error", message, file, ...positionAt(source, offset), source: "compiler" };
}

export async function buildModulePlan(files: readonly ModuleFile[], entry: string): Promise<ModulePlanResult> {
  await init;
  const sources = new Map(files.map((file) => [file.path, file.source]));
  const paths = new Set(sources.keys());
  if (!paths.has(entry)) {
    return { ok: false, diagnostics: [{ severity: "error", message: `The entry file ${entry} does not exist.`, source: "compiler" }] };
  }

  const diagnostics: CodeDiagnostic[] = [];
  const parsed = new Map<string, ParsedModule>();

  const parseModule = (path: string): ParsedModule => {
    const source = sources.get(path)!;
    const module: ParsedModule = { path, chunks: [], deps: [] };
    parsed.set(path, module);
    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(source, path);
    } catch (cause) {
      // The lexer reports the offset where it gave up.
      const offset = typeof (cause as { idx?: unknown }).idx === "number" ? (cause as { idx: number }).idx : 0;
      diagnostics.push(error(path, source, offset, "Syntax error: this file could not be read as a JavaScript module."));
      module.chunks.push(source);
      return module;
    }

    let cursor = 0;
    for (const found of imports) {
      // -2 is `import.meta`. A dynamic import whose argument is not a plain string cannot be linked
      // ahead of time; it is left alone and fails when it runs.
      if (found.d === -2 || found.n === undefined) continue;
      const resolved = resolveSpecifier(found.n, path, paths);
      if (resolved === null) {
        const relative = found.n.startsWith(".") || found.n.startsWith("/");
        diagnostics.push(
          error(
            path,
            source,
            found.s,
            relative
              ? `Cannot find the file "${found.n}" imported here.`
              : `Cannot import "${found.n}": only files of this project can be imported (there are no packages and no network).`,
          ),
        );
        continue;
      }
      // Static imports give the specifier without its quotes; dynamic ones include them.
      const quoted = found.d > -1;
      module.chunks.push(source.slice(cursor, quoted ? found.s : found.s - 1), { dep: resolved });
      cursor = quoted ? found.e : found.e + 1;
      if (!module.deps.includes(resolved)) module.deps.push(resolved);
    }
    module.chunks.push(source.slice(cursor));
    return module;
  };

  // Depth-first: a module is emitted after everything it imports. `stack` is the current import chain.
  const ordered: LinkedModule[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (path: string, stack: string[]): void => {
    if (state.get(path) === "done") return;
    if (state.get(path) === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(path)), path].join(" -> ");
      diagnostics.push({
        severity: "error",
        message: `Circular import: ${cycle}. Files that import each other cannot be loaded here; move the shared code into a third file.`,
        file: stack[stack.length - 1],
        source: "compiler",
      });
      return;
    }
    state.set(path, "visiting");
    const module = parsed.get(path) ?? parseModule(path);
    for (const dep of module.deps) visit(dep, [...stack, path]);
    state.set(path, "done");
    ordered.push({ path: module.path, chunks: module.chunks });
  };
  visit(entry, []);

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, plan: { entry, modules: ordered } };
}

/** The first existing candidate, else the first file (by order given) with one of the extensions. */
export function pickEntry(paths: readonly string[], candidates: readonly string[], extensions: readonly string[]): string | null {
  return (
    candidates.find((candidate) => paths.includes(candidate)) ??
    paths.find((path) => extensions.some((extension) => path.toLowerCase().endsWith(extension))) ??
    null
  );
}
