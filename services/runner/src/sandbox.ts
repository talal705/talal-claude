// Process sandbox for jobs. On macOS this is the system Seatbelt sandbox through /usr/bin/sandbox-exec.
// It starts from "allow default" and removes what is listed below, so anything not listed stays
// allowed. It protects a development machine from a learner's mistakes and from the obvious attacks;
// it is not the isolation boundary a public service needs (see README.md).
import { execFile } from "node:child_process";
import type { ExecutionPhase } from "./contract.ts";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

// WORK is the job's workspace, ROOT the directory holding every job's workspace, and RT0, RT1, ...
// the installation directories of the track's toolchain (a JDK, the .NET SDK). All are passed as
// sandbox parameters (-D), so no path is ever spliced into the profile text. Later rules win.
const COMMON_RULES = `(version 1)
(allow default)
(deny network*)
(deny signal)
(allow signal (target same-sandbox))
(deny file-write*)
(allow file-write* (subpath (param "WORK")) (literal "/dev/null") (literal "/dev/dtracehelper"))
`;

function runtimeSubpaths(count: number): string {
  return Array.from({ length: count }, (_, index) => `(subpath (param "RT${index}"))`).join(" ");
}

// The compiler needs its own installation and the SDK, wherever they are, so reads are a deny-list:
// user data, other volumes, temporary directories, package-manager trees (which hold local databases)
// and the other jobs' workspaces. The track's own toolchain directory is then allowed again.
function compileProfile(runtimeRoots: number): string {
  return `${COMMON_RULES}(deny file-read-data
  (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/root")
  (subpath "/private/var/folders") (subpath "/private/tmp")
  (subpath "/opt") (subpath "/usr/local") (subpath (param "ROOT")))
(allow file-read-data (subpath (param "WORK")) ${runtimeSubpaths(runtimeRoots)})
`;
}

// A learner's program gets an allow-list instead: the system libraries, its own workspace and, for
// a track that runs on a virtual machine (Java, .NET), that runtime's installation directory.
// It may execute only its own build or that runtime, may not create a child process, and may not
// look up system services.
function runProfile(runtimeRoots: number): string {
  return `${COMMON_RULES}(deny file-read-data)
(allow file-read-data
  (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share")
  (subpath "/private/var/db/timezone") (subpath "/private/var/db/dyld")
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom")
  (subpath (param "WORK")) ${runtimeSubpaths(runtimeRoots)})
(deny process-fork)
(deny process-exec*)
(allow process-exec* (subpath (param "WORK")) ${runtimeSubpaths(runtimeRoots)})
(deny mach-lookup)
`;
}

export interface Sandbox {
  kind: "macos-seatbelt" | "none";
  available: boolean;
  detail?: string;
  /**
   * Prefixes `argv` so it runs sandboxed. `workspace`, `workRoot` and `runtimeRoots` must be real
   * (symlink-free) paths.
   */
  wrap(phase: ExecutionPhase, workspace: string, workRoot: string, argv: string[], runtimeRoots?: string[]): string[];
}

const NO_SANDBOX_WRAP: Sandbox["wrap"] = (_phase, _workspace, _workRoot, argv) => argv;

/** Checks at startup that the sandbox really starts a process on this host. */
export function detectSandbox(): Promise<Sandbox> {
  if (process.platform !== "darwin") {
    return Promise.resolve({
      kind: "none",
      available: false,
      detail: `no local process sandbox is implemented for ${process.platform}`,
      wrap: NO_SANDBOX_WRAP,
    });
  }
  return new Promise((resolve) => {
    execFile(SANDBOX_EXEC, ["-p", "(version 1)(allow default)", "/usr/bin/true"], { timeout: 5_000 }, (error) => {
      if (error) {
        resolve({ kind: "none", available: false, detail: `sandbox-exec failed: ${error.message}`, wrap: NO_SANDBOX_WRAP });
        return;
      }
      resolve({
        kind: "macos-seatbelt",
        available: true,
        wrap: (phase, workspace, workRoot, argv, runtimeRoots = []) => [
          SANDBOX_EXEC,
          "-D",
          `WORK=${workspace}`,
          "-D",
          `ROOT=${workRoot}`,
          ...runtimeRoots.flatMap((root, index) => ["-D", `RT${index}=${root}`]),
          "-p",
          phase === "compile" ? compileProfile(runtimeRoots.length) : runProfile(runtimeRoots.length),
          ...argv,
        ],
      });
    });
  });
}
