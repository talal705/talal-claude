// C#: the .NET SDK's own compiler (Roslyn, `csc.dll`), then the .NET runtime.
//
// `dotnet build` is not used. Under the job sandbox the `dotnet` command-line tool fails at start:
// it insists on creating a machine-wide lock under /tmp/.dotnet, a directory shared by every .NET
// process of the host, which jobs may not write to. The compiler is the same one `dotnet build`
// runs; calling it directly needs no project file, no NuGet restore and no network. The price:
// only what the SDK ships can be referenced (the base class library), and there are no packages.
import { existsSync } from "node:fs";
import { readdir, realpath, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { RunnerRequestError, type CodeDiagnostic, type ToolchainStatus } from "../contract.ts";
import type { WorkspaceFile } from "../paths.ts";
import { firstLine, probe, type AdapterCommand, type JobPaths, type LanguageAdapter } from "./types.ts";

const SOURCE_PATTERN = /\.cs$/i;

// `Program.cs(3,21,3,28): error CS0029: Cannot implicitly convert type 'string' to 'int'`
// (end position present because of -errorendlocation), and `error CS5001: ...` without a file.
const LOCATED_PATTERN = /^(.+?)\((\d+),(\d+)(?:,(\d+),(\d+))?\): (error|warning) ([A-Z]+\d+): (.*)$/;
const UNLOCATED_PATTERN = /^(error|warning) ([A-Z]+\d+): (.*)$/;

export function parseCscDiagnostics(compilerOutput: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  for (const line of compilerOutput.split("\n")) {
    const located = LOCATED_PATTERN.exec(line.trimEnd());
    if (located) {
      const [, file, startLine, startColumn, endLine, endColumn, kind, code, message] = located;
      const diagnostic: CodeDiagnostic = {
        severity: kind === "warning" ? "warning" : "error",
        message: `${message} (${code})`,
        file: file.startsWith("./") ? file.slice(2) : file,
        line: Number(startLine),
        column: Number(startColumn),
        source: "compiler",
      };
      if (endLine !== undefined) {
        diagnostic.endLine = Number(endLine);
        diagnostic.endColumn = Number(endColumn);
      }
      diagnostics.push(diagnostic);
      continue;
    }
    const unlocated = UNLOCATED_PATTERN.exec(line.trimEnd());
    if (unlocated) diagnostics.push({ severity: unlocated[1] === "warning" ? "warning" : "error", message: `${unlocated[3]} (${unlocated[2]})`, source: "compiler" });
  }
  return diagnostics;
}

/** `Unhandled exception. System.X: message`, then `   at Type.Method() in ./Program.cs:line 11` frames. */
export function parseDotnetException(stderr: string, files: readonly WorkspaceFile[]): CodeDiagnostic[] {
  const lines = stderr.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Unhandled exception. "));
  if (start === -1) return [];
  const diagnostic: CodeDiagnostic = { severity: "error", message: lines[start].slice("Unhandled exception. ".length).trim(), source: "runtime" };
  const paths = new Set(files.map((file) => file.path));
  for (const line of lines.slice(start + 1)) {
    const frame = /^\s+at .* in (.+):line (\d+)\s*$/.exec(line);
    if (!frame) continue;
    const file = frame[1].startsWith("./") ? frame[1].slice(2) : frame[1];
    if (paths.has(file)) {
      diagnostic.file = file;
      diagnostic.line = Number(frame[2]);
      break;
    }
  }
  return [diagnostic];
}

// What `<ImplicitUsings>enable</ImplicitUsings>` gives a console project, so the SDK's own
// templates and most tutorials compile unchanged.
const GLOBAL_USINGS = ["System", "System.Collections.Generic", "System.IO", "System.Linq", "System.Net.Http", "System.Threading", "System.Threading.Tasks"]
  .map((name) => `global using ${name};\n`)
  .join("");

export interface CsharpAdapterOptions {
  /** Configured .NET root (RUNNER_DOTNET_ROOT). */
  dotnetRoot?: string;
  heapBytes: number;
  /** PATH to search when no root is configured or the configured one is unusable. Default: the runner's own. */
  searchPath?: string;
}

interface Installation {
  root: string;
  host: string;
  compiler: string;
  /** Reference assemblies the program is compiled against. */
  references: string[];
  runtimeVersion: string;
  sdkVersion: string;
}

/** The highest entry of a directory of version-named folders, or null. */
async function newest(directory: string): Promise<string | null> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const versions = names.filter((name) => /^\d+\./.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.at(-1) ?? null;
}

async function inspect(root: string): Promise<Installation | string> {
  const host = join(root, "dotnet");
  if (!existsSync(host)) return `${root} has no dotnet host`;
  const sdkVersion = await newest(join(root, "sdk"));
  if (sdkVersion === null) return `${root} has no SDK (a runtime alone cannot compile)`;
  const compiler = join(root, "sdk", sdkVersion, "Roslyn", "bincore", "csc.dll");
  if (!existsSync(compiler)) return `${root}: the SDK has no C# compiler at ${compiler}`;
  const runtimeVersion = await newest(join(root, "shared", "Microsoft.NETCore.App"));
  const packVersion = await newest(join(root, "packs", "Microsoft.NETCore.App.Ref"));
  if (runtimeVersion === null || packVersion === null) return `${root}: the runtime or its reference assemblies are missing`;
  const refRoot = join(root, "packs", "Microsoft.NETCore.App.Ref", packVersion, "ref");
  const framework = (await readdir(refRoot).catch(() => [] as string[])).filter((name) => /^net\d/.test(name)).sort().at(-1);
  if (framework === undefined) return `${root}: no reference assemblies under ${refRoot}`;
  const refDirectory = join(refRoot, framework);
  const references = (await readdir(refDirectory)).filter((name) => name.endsWith(".dll")).map((name) => join(refDirectory, name));
  return { root, host, compiler, references, runtimeVersion, sdkVersion };
}

export class CsharpAdapter implements LanguageAdapter {
  readonly track = "csharp";
  private readonly options: CsharpAdapterOptions;
  private installation: Installation | null = null;

  constructor(options: CsharpAdapterOptions) {
    this.options = options;
  }

  /** .NET roots to try, in order: the configured one, then those behind `dotnet` on PATH. */
  private async candidateRoots(): Promise<string[]> {
    const roots: string[] = [];
    if (this.options.dotnetRoot) roots.push(this.options.dotnetRoot);
    for (const directory of (this.options.searchPath ?? process.env.PATH ?? "").split(delimiter)) {
      const dotnet = join(directory, "dotnet");
      if (!directory || !existsSync(dotnet)) continue;
      const real = await realpath(dotnet).catch(() => null);
      if (real === null) continue;
      // The host sits in the root itself; a package manager may instead put a launcher in bin/ next to libexec/.
      roots.push(dirname(real), join(dirname(dirname(real)), "libexec"));
    }
    return roots;
  }

  async detect(): Promise<ToolchainStatus> {
    const tried: string[] = [];
    for (const candidate of await this.candidateRoots()) {
      const root = await realpath(candidate).catch(() => null);
      if (root === null) {
        tried.push(`${candidate} does not exist`);
        continue;
      }
      const found = await inspect(root);
      if (typeof found === "string") {
        tried.push(found);
        continue;
      }
      // The compiler must really start on this runtime.
      const version = await probe(found.host, ["exec", found.compiler, "-version"]);
      if (!version.ok) {
        tried.push(`${root}: the C# compiler did not run (${firstLine(version.output)})`);
        continue;
      }
      this.installation = found;
      return { available: true, version: `.NET SDK ${found.sdkVersion}, runtime ${found.runtimeVersion}, C# compiler ${firstLine(version.output)}` };
    }
    return {
      available: false,
      reason: "toolchain_not_installed",
      detail: `The .NET SDK is not installed on the runner host${tried.length > 0 ? ` (tried ${tried.join("; ")})` : " (no dotnet found)"}`,
    };
  }

  runtimeRoots(): string[] {
    return this.installation === null ? [] : [this.installation.root];
  }

  checkFiles(files: WorkspaceFile[]): void {
    if (!files.some((file) => SOURCE_PATTERN.test(file.path))) {
      throw new RunnerRequestError("invalid_request", "a C# job needs at least one .cs file");
    }
  }

  private environment(): Record<string, string> {
    const { root } = this.installation!;
    return {
      DOTNET_ROOT: root,
      DOTNET_NOLOGO: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      // No ICU data and no culture files are needed.
      DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
      // No diagnostics socket in the temp directory, and workstation rather than server garbage collection.
      DOTNET_EnableDiagnostics: "0",
      DOTNET_gcServer: "0",
    };
  }

  async prepare(_files: WorkspaceFile[], paths: JobPaths): Promise<void> {
    const { references, runtimeVersion } = this.installation!;
    await writeFile(join(paths.out, "refs.rsp"), references.map((reference) => `-r:"${reference}"\n`).join(""));
    await writeFile(join(paths.out, "GlobalUsings.g.cs"), GLOBAL_USINGS);
    await writeFile(
      join(paths.out, "program.runtimeconfig.json"),
      JSON.stringify({
        runtimeOptions: {
          tfm: `net${runtimeVersion.split(".").slice(0, 2).join(".")}`,
          framework: { name: "Microsoft.NETCore.App", version: runtimeVersion },
          configProperties: {
            "System.Globalization.Invariant": true,
            "System.GC.Concurrent": false,
            "System.GC.HeapHardLimit": this.options.heapBytes,
          },
        },
      }),
    );
  }

  compileCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    if (this.installation === null) throw new Error("the .NET SDK was not detected");
    const sources = files.filter((file) => SOURCE_PATTERN.test(file.path)).map((file) => file.path);
    return {
      argv: [
        this.installation.host,
        "exec",
        this.installation.compiler,
        "-nologo",
        // Only the options given here: no csc.rsp from the SDK, no implicit mscorlib.
        "-noconfig",
        "-nostdlib",
        "-target:exe",
        // Unoptimized with debug information, so exception stack traces carry the right line numbers.
        "-debug:portable",
        "-optimize-",
        "-nullable:enable",
        "-utf8output",
        "-errorendlocation",
        // Stack traces name files as the learner did, not by their place on the runner's disk.
        `-pathmap:${paths.src}=.`,
        `-out:${join(paths.out, "program.dll")}`,
        `@${join(paths.out, "refs.rsp")}`,
        join(paths.out, "GlobalUsings.g.cs"),
        // Validated relative paths: none can start with "-", "/" or "@" and be read as an option.
        ...sources,
      ],
      env: this.environment(),
    };
  }

  runCommand(_files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    if (this.installation === null) throw new Error("the .NET SDK was not detected");
    return { argv: [this.installation.host, "exec", join(paths.out, "program.dll")], env: this.environment() };
  }

  parseDiagnostics(compilerOutput: string): CodeDiagnostic[] {
    return parseCscDiagnostics(compilerOutput);
  }

  parseRuntimeDiagnostics(stderr: string, files: WorkspaceFile[]): CodeDiagnostic[] {
    return parseDotnetException(stderr, files);
  }
}
