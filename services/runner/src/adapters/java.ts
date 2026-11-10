// Java: javac, then the JVM, both from one JDK.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { RunnerRequestError, type CodeDiagnostic, type ToolchainStatus } from "../contract.ts";
import type { WorkspaceFile } from "../paths.ts";
import { fileByBaseName, firstLine, probe, type AdapterCommand, type JobPaths, type LanguageAdapter } from "./types.ts";

const SOURCE_PATTERN = /\.java$/i;

// `Main.java:3: error: incompatible types: String cannot be converted to int`, then the source
// line, then a line with a caret under the column.
const LOCATED_PATTERN = /^(.+\.java):(\d+): (error|warning): (.*)$/;
const UNLOCATED_PATTERN = /^(error|warning): (.*)$/;
const CARET_PATTERN = /^(\s*)\^\s*$/;

export function parseJavacDiagnostics(compilerOutput: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  const lines = compilerOutput.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const located = LOCATED_PATTERN.exec(lines[index]);
    if (located) {
      const diagnostic: CodeDiagnostic = {
        severity: located[3] === "warning" ? "warning" : "error",
        message: located[4],
        file: located[1].startsWith("./") ? located[1].slice(2) : located[1],
        line: Number(located[2]),
        source: "compiler",
      };
      // The caret line follows within a few lines, before the next diagnostic.
      for (let ahead = index + 1; ahead < Math.min(index + 8, lines.length); ahead++) {
        if (LOCATED_PATTERN.test(lines[ahead])) break;
        const caret = CARET_PATTERN.exec(lines[ahead]);
        if (caret) {
          diagnostic.column = caret[1].length + 1;
          break;
        }
      }
      diagnostics.push(diagnostic);
      continue;
    }
    const unlocated = UNLOCATED_PATTERN.exec(lines[index]);
    if (unlocated) diagnostics.push({ severity: unlocated[1] === "warning" ? "warning" : "error", message: unlocated[2], source: "compiler" });
  }
  return diagnostics;
}

/** Source text with comments and string or character literals blanked, so words inside them are not read as code. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (text) => text.replace(/[^\n]/g, " "));
}

/**
 * The fully qualified name of the class to start, read from the sources: the class that declares a
 * `main` method (`public static void main(String[])`, or Java 25's instance `void main()`).
 * With several, `Main.java` is preferred, then the first file. Null when no file has one.
 */
export function findMainClass(files: readonly WorkspaceFile[]): string | null {
  const candidates: { path: string; name: string }[] = [];
  for (const file of files) {
    if (!SOURCE_PATTERN.test(file.path)) continue;
    const code = codeOnly(file.content);
    const main = /\bvoid\s+main\s*\(/.exec(code);
    if (!main) continue;
    const packageName = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1];
    // The top-level type whose body holds `main` (types nested inside it, such as a helper
    // interface, are skipped). None means a compact source file, whose class is named after the file.
    let className = file.path.slice(file.path.lastIndexOf("/") + 1).replace(SOURCE_PATTERN, "");
    let depth = 0;
    let pending: string | null = null;
    const declaration = /\b(?:class|record|enum|interface)\s+([A-Za-z_$][\w$]*)/y;
    for (let index = 0; index < main.index; index++) {
      const char = code[index];
      if (char === "{") {
        if (depth === 0 && pending !== null) className = pending;
        depth++;
      } else if (char === "}") {
        depth--;
        // That top-level type ended before `main`: it is not the one.
        if (depth === 0) pending = null;
      } else if (depth === 0) {
        declaration.lastIndex = index;
        const found = declaration.exec(code);
        if (found) {
          pending = found[1];
          index += found[0].length - 1;
        }
      }
    }
    if (depth === 0) className = file.path.slice(file.path.lastIndexOf("/") + 1).replace(SOURCE_PATTERN, "");
    candidates.push({ path: file.path, name: packageName ? `${packageName}.${className}` : className });
  }
  const preferred = candidates.find((candidate) => /(^|\/)Main\.java$/.test(candidate.path)) ?? candidates[0];
  return preferred?.name ?? null;
}

/** An uncaught exception as the JVM prints it: the exception line, then `at pkg.Class.method(File.java:12)` frames. */
export function parseJavaException(stderr: string, files: readonly WorkspaceFile[]): CodeDiagnostic[] {
  const lines = stderr.split("\n");
  const start = lines.findIndex((line) => /^Exception in thread "[^"]*" /.test(line));
  if (start === -1) return [];
  const diagnostic: CodeDiagnostic = { severity: "error", message: lines[start].replace(/^Exception in thread "[^"]*" /, ""), source: "runtime" };
  for (const line of lines.slice(start + 1)) {
    const frame = /^\s+at .+\(([^():]+\.java):(\d+)\)/.exec(line);
    if (!frame) {
      if (/^\s+(at |\.\.\. )/.test(line)) continue;
      break;
    }
    // Frames name only the file, not its folder; use the first one that is a file of the project.
    const file = fileByBaseName(files, frame[1]);
    if (file) {
      diagnostic.file = file;
      diagnostic.line = Number(frame[2]);
      break;
    }
  }
  return [diagnostic];
}

export interface JavaAdapterOptions {
  /** Configured JDK home (RUNNER_JAVA_HOME). */
  javaHome?: string;
  heapBytes: number;
  /** PATH to search when no home is configured or the configured one is unusable. Default: the runner's own. */
  searchPath?: string;
}

export class JavaAdapter implements LanguageAdapter {
  readonly track = "java";
  private readonly options: JavaAdapterOptions;
  private home: string | null = null;

  constructor(options: JavaAdapterOptions) {
    this.options = options;
  }

  /** JDK homes to try, in order: the configured one, the one macOS registers, the one behind `javac` on PATH. */
  private async candidateHomes(): Promise<string[]> {
    const homes: string[] = [];
    if (this.options.javaHome) homes.push(this.options.javaHome);
    if (process.platform === "darwin" && this.options.searchPath === undefined) {
      const registered = await probe("/usr/libexec/java_home", []);
      if (registered.ok) homes.push(firstLine(registered.output));
    }
    for (const directory of (this.options.searchPath ?? process.env.PATH ?? "").split(delimiter)) {
      const javac = join(directory, "javac");
      if (directory && existsSync(javac)) {
        // PATH usually holds a link into the JDK; the home is two levels above the real file.
        const real = await realpath(javac).catch(() => null);
        if (real) homes.push(dirname(dirname(real)));
      }
    }
    return homes;
  }

  async detect(): Promise<ToolchainStatus> {
    const tried: string[] = [];
    for (const candidate of await this.candidateHomes()) {
      const home = await realpath(candidate).catch(() => null);
      if (home === null) {
        tried.push(`${candidate} does not exist`);
        continue;
      }
      // Both must really run: macOS has /usr/bin/javac and /usr/bin/java placeholders without any JDK.
      const javac = await probe(join(home, "bin", "javac"), ["-version"]);
      const java = javac.ok ? await probe(join(home, "bin", "java"), ["-version"]) : javac;
      if (javac.ok && java.ok) {
        this.home = home;
        return { available: true, version: `${firstLine(javac.output)} (${firstLine(java.output)})` };
      }
      tried.push(`${home}: ${firstLine((javac.ok ? java : javac).output) || "javac could not be run"}`);
    }
    return {
      available: false,
      reason: "toolchain_not_installed",
      detail: `A JDK is not installed on the runner host${tried.length > 0 ? ` (tried ${tried.join("; ")})` : " (no javac found)"}`,
    };
  }

  runtimeRoots(): string[] {
    return this.home === null ? [] : [this.home];
  }

  checkFiles(files: WorkspaceFile[]): void {
    if (!files.some((file) => SOURCE_PATTERN.test(file.path))) {
      throw new RunnerRequestError("invalid_request", "a Java job needs at least one .java file");
    }
  }

  preflight(files: WorkspaceFile[]): CodeDiagnostic[] {
    if (findMainClass(files) !== null) return [];
    return [{ severity: "error", message: "No main method was found. A program starts in `public static void main(String[] args)`.", source: "compiler" }];
  }

  /** JVM settings shared by the compiler and the program: small, quiet, and with temporary files in the job. */
  private jvmFlags(paths: JobPaths, heapBytes: number): string[] {
    return [
      `-Xmx${Math.floor(heapBytes / (1024 * 1024))}m`,
      "-XX:+UseSerialGC",
      "-XX:TieredStopAtLevel=1",
      // No shared performance-data file in the system temp directory.
      "-XX:-UsePerfData",
      `-Djava.io.tmpdir=${paths.tmp}`,
      `-Duser.home=${paths.tmp}`,
      "-Dfile.encoding=UTF-8",
      "-Dstdout.encoding=UTF-8",
      "-Dstderr.encoding=UTF-8",
    ];
  }

  compileCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    if (this.home === null) throw new Error("the JDK was not detected");
    const sources = files.filter((file) => SOURCE_PATTERN.test(file.path)).map((file) => file.path);
    return {
      argv: [
        join(this.home, "bin", "javac"),
        ...this.jvmFlags(paths, Math.max(this.options.heapBytes, 384 * 1024 * 1024)).map((flag) => `-J${flag}`),
        "-encoding",
        "UTF-8",
        // No annotation processors: compiling must not run code from the project.
        "-proc:none",
        "-Xmaxerrs",
        "50",
        "-d",
        paths.out,
        // Validated relative paths: none can start with "-" or "@" and be read as an option or an argument file.
        ...sources,
      ],
    };
  }

  runCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    if (this.home === null) throw new Error("the JDK was not detected");
    const mainClass = findMainClass(files);
    if (mainClass === null) throw new Error("no main class");
    return {
      argv: [join(this.home, "bin", "java"), ...this.jvmFlags(paths, this.options.heapBytes), "-XX:MaxMetaspaceSize=96m", "-cp", paths.out, mainClass],
    };
  }

  parseDiagnostics(compilerOutput: string): CodeDiagnostic[] {
    return parseJavacDiagnostics(compilerOutput);
  }

  parseRuntimeDiagnostics(stderr: string, files: WorkspaceFile[]): CodeDiagnostic[] {
    return parseJavaException(stderr, files);
  }
}
