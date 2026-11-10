// Real TypeScript type checking of a multi-file project, then emit to JavaScript modules.
// Pure: it receives the compiler and the lib .d.ts texts, so it runs in the checker worker and in tests.
import type { CodeDiagnostic } from "@ytl/contracts";
import type * as TS from "typescript-js";

export interface TsSourceFile {
  /** Project-relative path, e.g. `main.ts`. */
  path: string;
  source: string;
}

export interface EmittedModule {
  /** Path of the JavaScript module, e.g. `lib/util.js`. */
  path: string;
  source: string;
  /** The TypeScript file it came from, and the source map between them. */
  from: string;
  map: string;
}

export interface TsCheckResult {
  diagnostics: CodeDiagnostic[];
  /** Empty when there are errors: a program with type errors is not run. */
  emitted: EmittedModule[];
}

const PROJECT_ROOT = "/project/";
const LIB_ROOT = "/lib/";
const ENV_FILE = `${PROJECT_ROOT}__ytl_env.d.ts`;
// Globals the sandbox worker gives a program beyond the standard ones.
const ENV_SOURCE = "/** The next line of the program's input, or null when there is no more. */\ndeclare function readLine(): string | null;\n";

/** The standard library a console program is checked against: the language, plus a worker's globals (console, timers). */
export const CONSOLE_LIBS = ["lib.es2022.d.ts", "lib.webworker.d.ts"] as const;

export function isTypeScriptFile(path: string): boolean {
  return /\.(ts|mts)$/i.test(path) && !/\.d\.(ts|mts)$/i.test(path);
}

/** File names of the libs a lib file pulls in with `/// <reference lib="..." />`. */
export function referencedLibs(libSource: string): string[] {
  return Array.from(libSource.matchAll(/^\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/gm), (match) => `lib.${match[1]}.d.ts`);
}

export function checkAndEmit(ts: typeof TS, files: readonly TsSourceFile[], libs: ReadonlyMap<string, string>): TsCheckResult {
  const sources = new Map<string, string>([[ENV_FILE, ENV_SOURCE]]);
  for (const file of files) sources.set(PROJECT_ROOT + file.path, file.source);
  for (const [name, text] of libs) sources.set(LIB_ROOT + name, text);

  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: [...CONSOLE_LIBS],
    strict: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    skipLibCheck: true,
    // No packages exist here; do not look for @types.
    types: [],
    sourceMap: true,
    rootDir: PROJECT_ROOT,
    outDir: "/out/",
    newLine: ts.NewLineKind.LineFeed,
  };

  const outputs = new Map<string, string>();
  const host: TS.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = sources.get(fileName);
      return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: () => LIB_ROOT + CONSOLE_LIBS[0],
    getDefaultLibLocation: () => LIB_ROOT.slice(0, -1),
    writeFile: (fileName, text) => void outputs.set(fileName, text),
    getCurrentDirectory: () => PROJECT_ROOT.slice(0, -1),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => sources.has(fileName),
    readFile: (fileName) => sources.get(fileName),
    directoryExists: (directory) => {
      const prefix = directory.endsWith("/") ? directory : `${directory}/`;
      for (const name of sources.keys()) if (name.startsWith(prefix)) return true;
      return false;
    },
    getDirectories: () => [],
  };

  const roots = [ENV_FILE, ...files.filter((file) => isTypeScriptFile(file.path)).map((file) => PROJECT_ROOT + file.path)];
  const program = ts.createProgram(roots, options, host);

  const diagnostics: CodeDiagnostic[] = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const result: CodeDiagnostic = {
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "info",
      message: `${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")} (TS${diagnostic.code})`,
      source: "type-checker",
    };
    if (diagnostic.file && diagnostic.start !== undefined) {
      const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0));
      const name = diagnostic.file.fileName;
      result.file = name.startsWith(PROJECT_ROOT) ? name.slice(PROJECT_ROOT.length) : name;
      result.line = start.line + 1;
      result.column = start.character + 1;
      result.endLine = end.line + 1;
      result.endColumn = end.character + 1;
    }
    return result;
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return { diagnostics, emitted: [] };

  program.emit();
  const emitted: EmittedModule[] = [];
  for (const file of files) {
    if (!isTypeScriptFile(file.path)) continue;
    const jsPath = file.path.replace(/\.(ts|mts)$/i, ".js");
    const source = outputs.get(`/out/${jsPath}`);
    if (source === undefined) continue;
    emitted.push({
      path: jsPath,
      // The map travels separately; the comment would point at a file that does not exist.
      source: source.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n"),
      from: file.path,
      map: outputs.get(`/out/${jsPath}.map`) ?? "",
    });
  }
  return { diagnostics, emitted };
}
