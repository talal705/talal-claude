import { join } from "node:path";
import { RunnerRequestError, type CodeDiagnostic, type ToolchainStatus } from "../contract.ts";
import type { WorkspaceFile } from "../paths.ts";
import { firstLine, probe, type AdapterCommand, type JobPaths, type LanguageAdapter } from "./types.ts";

const SOURCE_PATTERN = /\.(cpp|cc|cxx)$/i;

// clang and gcc: `main.cpp:3:5: error: message`. Notes attach to the diagnostic before them.
const LOCATED_PATTERN = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;
// Driver and linker lines without a source position: `ld: symbol(s) not found for architecture arm64`.
const UNLOCATED_PATTERN = /^(?:ld|clang\+\+|clang|g\+\+|collect2)(?:: (fatal error|error|warning))?: (.*)$/;

export function parseClangDiagnostics(compilerOutput: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  for (const line of compilerOutput.split("\n")) {
    const located = LOCATED_PATTERN.exec(line);
    if (located) {
      const [, file, lineNumber, column, kind, message] = located;
      diagnostics.push({
        severity: kind === "warning" ? "warning" : kind === "note" ? "info" : "error",
        message,
        // Learner files are compiled by relative path, so this is the name they gave the file.
        file: file.startsWith("./") ? file.slice(2) : file,
        line: Number(lineNumber),
        column: Number(column),
        source: "compiler",
      });
      continue;
    }
    const unlocated = UNLOCATED_PATTERN.exec(line);
    if (unlocated) {
      diagnostics.push({
        severity: unlocated[1] === "warning" ? "warning" : "error",
        message: unlocated[2],
        source: "compiler",
      });
    }
  }
  return diagnostics;
}

export class CppAdapter implements LanguageAdapter {
  readonly track = "cpp";
  private compiler: string | null = null;
  private sdkRoot: string | null = null;

  async detect(): Promise<ToolchainStatus> {
    let compiler: string | null = null;
    if (process.platform === "darwin") {
      // /usr/bin/clang++ is a launcher that exists even without the developer tools. Resolve the
      // real compiler and SDK once here, so jobs do not depend on that launcher or its cache.
      const found = await probe("/usr/bin/xcrun", ["--find", "clang++"]);
      const sdk = await probe("/usr/bin/xcrun", ["--show-sdk-path"]);
      if (found.ok && sdk.ok) {
        compiler = firstLine(found.output);
        this.sdkRoot = firstLine(sdk.output);
      }
    } else {
      for (const candidate of ["/usr/bin/clang++", "/usr/bin/g++"]) {
        if ((await probe(candidate, ["--version"])).ok) {
          compiler = candidate;
          break;
        }
      }
    }
    if (compiler === null) {
      return { available: false, reason: "toolchain_not_installed", detail: "no C++ compiler (clang++ or g++) was found" };
    }
    const version = await probe(compiler, ["--version"]);
    if (!version.ok) {
      return { available: false, reason: "toolchain_not_installed", detail: `${compiler} --version failed: ${firstLine(version.output)}` };
    }
    this.compiler = compiler;
    return { available: true, version: firstLine(version.output) };
  }

  // The compiler and SDK are in system locations the compile profile can already read, and the
  // program it builds needs nothing but the system libraries.
  runtimeRoots(): string[] {
    return [];
  }

  checkFiles(files: WorkspaceFile[]): void {
    if (!files.some((file) => SOURCE_PATTERN.test(file.path))) {
      throw new RunnerRequestError("invalid_request", "a C++ job needs at least one .cpp, .cc or .cxx file");
    }
  }

  compileCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    if (this.compiler === null) throw new Error("C++ toolchain was not detected");
    const sources = files.filter((file) => SOURCE_PATTERN.test(file.path)).map((file) => file.path);
    return {
      argv: [
        this.compiler,
        "-std=c++20",
        "-O0",
        "-Wall",
        "-Wextra",
        "-fno-color-diagnostics",
        "-ferror-limit=50",
        "-I.",
        "-o",
        join(paths.out, "program"),
        // Validated relative paths: none can start with "-" and be read as an option.
        ...sources,
      ],
      env: this.sdkRoot === null ? {} : { SDKROOT: this.sdkRoot },
    };
  }

  runCommand(_files: WorkspaceFile[], paths: JobPaths): AdapterCommand {
    return { argv: [join(paths.out, "program")] };
  }

  parseDiagnostics(compilerOutput: string): CodeDiagnostic[] {
    return parseClangDiagnostics(compilerOutput);
  }
}
