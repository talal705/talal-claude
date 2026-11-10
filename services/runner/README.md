# Runner service

Compiles and runs learner programs for the tracks that cannot run in the browser. It is a separate
process from the web app, has no dependencies beyond Node, and is given no platform secret.

| Track | State |
|---|---|
| C++ | Real compiler (`clang++ -std=c++20 -Wall -Wextra`), real executable |
| Java | Real JDK: `javac`, then `java` on the class that declares `main` |
| C# | Real .NET SDK: its C# compiler (`csc.dll`, Roslyn), then the .NET runtime |

At startup the runner really executes each toolchain to see whether it exists (macOS ships a
`/usr/bin/javac` placeholder that is present without any JDK, so the file existing proves nothing).
A track whose toolchain is missing reports `toolchain_not_installed` with empty output. The runner
never prints anything on a program's behalf.

### Where the toolchains are looked for

- **Java:** `RUNNER_JAVA_HOME` (must contain `bin/javac` and `bin/java`); if unset or unusable, the
  JDK that macOS registers (`/usr/libexec/java_home`), then the JDK behind `javac` on `PATH`.
  Homebrew's `openjdk@25` is keg-only and found by neither fallback, so set the variable.
- **C#:** `RUNNER_DOTNET_ROOT` (the directory holding the `dotnet` host, `sdk/`, `packs/`, `shared/`);
  if unset or unusable, the installation behind `dotnet` on `PATH`. A runtime without an SDK does not count.

### Java

- Every `.java` file is compiled with `javac -encoding UTF-8 -proc:none -d <out>`. Annotation
  processing is off, so compiling never runs code from the project.
- The class to start is read from the sources: the top-level type that declares `main`
  (`Main.java` is preferred when several do). Packages and Java 25 compact source files work. A
  project with no `main` ends as a compile-phase error before `javac` runs.
- Compiler messages are parsed to file, line and column (the column comes from the caret line). An
  uncaught exception is parsed from the stack trace to the first frame that is a project file.
- The JVM runs with `-Xmx256m -XX:MaxMetaspaceSize=96m -XX:+UseSerialGC`; a program that needs more
  heap gets `java.lang.OutOfMemoryError`.

### C#

- The runner calls the SDK's compiler directly: `dotnet exec <sdk>/Roslyn/bincore/csc.dll`, against
  the reference assemblies in `packs/Microsoft.NETCore.App.Ref`. It does **not** run `dotnet build`.
  Reason: inside the job sandbox the `dotnet` command-line tool fails at start, because it creates a
  machine-wide lock under `/tmp/.dotnet`, a directory shared by every .NET process on the host that
  jobs are not allowed to write to. The compiler is the same one `dotnet build` invokes.
- Consequences: no project file, no NuGet restore, no network, and **no packages**: a program can
  use the base class library the SDK ships and nothing else. There is no telemetry and no
  first-run step, because the command-line tool never runs.
- The usings a console project gets implicitly (`System`, `System.Collections.Generic`, `System.IO`,
  `System.Linq`, `System.Net.Http`, `System.Threading`, `System.Threading.Tasks`) are added, so
  top-level statements and the SDK's templates compile unchanged. Nullable checks are on.
- Builds are unoptimized with debug information, so stack traces carry correct line numbers, and
  file names in them are the learner's own (`-pathmap`).
- The runtime gets a 256 MiB garbage-collected heap limit (`System.GC.HeapHardLimit`); passing it
  ends the program with `System.OutOfMemoryException`.
- Measured once on this machine (Apple Silicon, files already in the disk cache), for a hello-world
  job inside the sandbox: C# compile 0.23 s and run 0.03 s; Java compile 0.18 s and run 0.03 s;
  C++ compile about 0.3 s. A first run after a restart will be slower; that was not measured.

## Run

```bash
node services/runner/src/main.ts        # Node 22.18+ runs the TypeScript sources directly
npx vitest run services/runner          # tests against the real toolchains; a missing one skips its tests with a SKIPPED line
```

| Variable | Default | Meaning |
|---|---|---|
| `RUNNER_HOST` | `127.0.0.1` | Listen address. A non-loopback address is refused unless `RUNNER_TOKEN` is set |
| `RUNNER_PORT` | `4000` | Listen port |
| `RUNNER_TOKEN` | unset | When set, `/jobs` requests need `Authorization: Bearer <token>` |
| `RUNNER_TIMEOUT_MS` | `10000` | Wall-clock limit of the run phase |
| `RUNNER_COMPILE_TIMEOUT_MS` | `30000` | Wall-clock limit of the compile phase |
| `RUNNER_MAX_OUTPUT_BYTES` | `1048576` | Cap for each of stdout, stderr and compiler output |
| `RUNNER_MAX_CONCURRENT` | `2` | Jobs executing at once |
| `RUNNER_MAX_QUEUED` | `16` | Jobs waiting; beyond this, submissions are refused |
| `RUNNER_WORK_ROOT` | system temp directory | Parent of the per-job workspaces |
| `RUNNER_SANDBOX` | `required` | `off` runs jobs without the sandbox. For debugging the runner only |
| `RUNNER_JAVA_HOME` | looked up | JDK home for the Java track |
| `RUNNER_DOTNET_ROOT` | looked up | .NET root for the C# track |

`main.ts` does not read `.env.local`.

## HTTP API

The web app's server calls this API. Browsers are refused: no CORS headers are sent, a request with an
`Origin` header gets 403, and so does a `Host` header other than `localhost`, `127.0.0.1` or `[::1]`.

| Request | Answer |
|---|---|
| `GET /health` | Toolchains (available, version, reason), sandbox, queue counts, limits |
| `POST /jobs` with an `ExecutionRequest` as JSON | `202` and a `JobSnapshot` (`executionId`, `status`) |
| `GET /jobs/:id` | The `JobSnapshot`; `result` is present once the job has finished |
| `GET /jobs/:id?wait=1` | Same, but answers only when the job has finished |
| `DELETE /jobs/:id` | Stop. Kills the job, waits until it is gone, returns the final `JobSnapshot` |

Errors are `{ "error": { "code", "message" } }`: `400 invalid_request`, `401 unauthorized`,
`403 forbidden_host` / `forbidden_origin`, `404 not_found`, `405`, `413 payload_too_large`,
`415 unsupported_media_type`, `429 queue_full`.

The request and result types are in `src/contract.ts`. A finished job has one of these statuses:

| `status` | `phase` | Meaning |
|---|---|---|
| `success` | `run` | The program exited with code 0 |
| `error` | `compile` | Compile or link error. `compilerOutput` holds the raw text, `diagnostics` the parsed file, line and column |
| `error` | `run` | Non-zero `exitCode`, or killed by `signal` (for example `SIGSEGV`) |
| `timeout` | `compile` or `run` | Wall-clock or CPU-time limit reached |
| `output_limit` | `compile` or `run` | A stream passed the byte cap; the kept part is marked `…Truncated` |
| `memory_limit` | `compile` or `run` | Killed by the memory watchdog |
| `cancelled` | `compile`, `run` or `null` | Stopped by the client (`null`: it was still queued) |
| `runner_unavailable` | `null` | Nothing ran. See `unavailableReason` |

Results are kept in memory (the newest 200) and are lost when the runner restarts.

## What a job gets

- **Workspace.** A new directory from `mkdtemp` under the work root, mode 0700, with `src/` (the
  submitted files, also the working directory), `out/` (the executable) and `tmp/`. It is deleted when
  the job ends, whatever the outcome, including Stop and runner shutdown.
- **File names.** Each name is a relative path of up to 6 segments. A segment may contain ASCII
  letters, digits, `_`, `-` and `.`, and must start with a letter, digit or `_`. That rules out `..`,
  absolute paths, backslashes, hidden files, and names a compiler would read as an option. Duplicates
  that differ only in case are rejected. A bad name refuses the whole request before anything is written.
- **Commands.** Every process is started from an argument array. The compiler receives validated file
  paths; file contents are never part of a command line. The one shell involved runs a fixed script
  that sets `ulimit` values and then `exec`s the command it was handed as arguments.
- **Environment.** Built from nothing: `PATH=/usr/bin:/bin`, `HOME` and `TMPDIR` inside the workspace,
  `LANG` and `LC_ALL`, and `SDKROOT` for the compiler. No variable of the runner's own environment is
  passed on.
- **Stop.** Each process leads its own process group, and Stop, a timeout and every limit below send
  `SIGKILL` to the whole group.
- **Queue.** `RUNNER_MAX_CONCURRENT` jobs execute; up to `RUNNER_MAX_QUEUED` wait; further submissions
  get `429 queue_full`.

## Limits on this machine (macOS)

Enforced, each covered by a test that runs a real program:

| Limit | Mechanism | Default |
|---|---|---|
| Wall time, per phase | Timer in the runner, then `SIGKILL` to the group | 30 s compile, 10 s run |
| CPU time | `RLIMIT_CPU` (`ulimit -t`) | 10 s run, 30 s compile |
| Output size | Counted by the runner as it arrives; the job is killed at the cap | 1 MiB per stream |
| Size of any file the program writes | `RLIMIT_FSIZE` (`ulimit -f`); the program gets `SIGXFSZ` | 16 MiB |
| Open files | `RLIMIT_NOFILE` (`ulimit -n`) | 256 |
| Core dumps | `RLIMIT_CORE` set to 0 | off |
| Network | Sandbox: all network access denied | none |
| Child processes | Sandbox: `fork` denied in the run phase, and so is replacing itself with another program | none |
| File reads, run phase | Sandbox allow-list: system libraries and the job's workspace | |
| File reads, compile phase | Sandbox deny-list: `/Users`, `/Volumes`, `/opt`, `/usr/local`, temp directories, other jobs' workspaces | |
| File writes | Sandbox: only inside the job's workspace | |
| Signals to other processes | Sandbox: denied | |
| System service lookups (run phase) | Sandbox: denied | |
| Managed heap (Java, C#) | `-Xmx` for the JVM, `System.GC.HeapHardLimit` for .NET | 256 MiB |

What the Java and C# tracks add to the sandbox, and nothing else: the installation directory of
their toolchain (the JDK home, the .NET root; real paths, found at startup) may be **read** in both
phases and **executed** in the run phase, because the program is run by `java` or `dotnet` from that
directory rather than being an executable of its own. Network, child processes, signals, service
lookups and file writes are exactly as for C++; the tests check each for both languages.

The sandbox is macOS Seatbelt, started through `/usr/bin/sandbox-exec`. The runner checks at startup
that it works and, by default, refuses to execute anything when it does not (`sandbox_unavailable`).

Not enforced, or only partly:

- **Memory has no hard ceiling.** macOS does not apply `RLIMIT_AS` or `RLIMIT_DATA` (`ulimit -v` and
  `ulimit -d` fail with "Invalid argument" here). Instead a watchdog samples the resident memory of
  the job's process group every 100 ms and kills the job above 512 MiB (2 GiB while compiling). A
  program that allocates faster than the sampling interval can overshoot before it is killed, and
  memory that is reserved but never touched is not counted.
- **For Java and C# the heap limit covers the managed heap only.** Thread stacks, the JIT's code
  and the runtime's own memory are outside it; the watchdog above is what bounds the whole process.
  Their runtimes start several threads of their own, and all of them count toward the CPU-time limit.
- **Disk use is bounded per file, not per job.** A program can write many files of up to 16 MiB each
  until its time limit. The workspace is deleted afterwards.
- **No CPU share or core limit.** A job can use all cores for its time limit; only the concurrency
  setting bounds the total.
- **Threads are not limited.**
- **A process that leaves its process group** (`setsid`) would survive a group kill. In the run phase
  the sandbox prevents this, because the program cannot create a second process. It applies to the
  compile phase, which runs the compiler rather than learner code, and to `RUNNER_SANDBOX=off`.
- **The sandbox is not a complete jail.** It starts from "allow default" and removes the items in
  the table. Jobs run as the same operating-system user as the runner, share its kernel, and can
  still use any facility the profile does not name. `sandbox-exec` is marked deprecated by Apple and
  its profile language is not a documented public interface.
- **The compiler can read world-readable system files** outside the denied directories, and an
  `#include` of such a file can echo a line of it in an error message.
- **Other platforms.** There is no sandbox implementation for Linux or Windows here. On them the
  runner reports C++ as `sandbox_unavailable` unless `RUNNER_SANDBOX=off` is set.

## Not suitable for public use as it is

This runner is for one developer's machine or a trusted classroom network. Running code from
arbitrary internet users needs a boundary built for untrusted code: each job in a gVisor sandbox or
a microVM (Firecracker class), or a managed runner that provides one, with a non-root user, cgroup
limits for memory, CPU and process count, no network, and a read-only root file system. A plain
Docker container shares the host kernel and is not that boundary by itself. Such a deployment also
has to re-test the compilers inside the chosen sandbox. None of that exists in this repository yet.

Also open: the runner binds to loopback and its token is optional there; the web app's route that
will call it has to enforce who may run what, and per-user quotas.
