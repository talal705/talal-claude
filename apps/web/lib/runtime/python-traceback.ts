// Reads a Python traceback (as printed to stderr by the Python sandbox) into a diagnostic.
import type { CodeDiagnostic } from "@ytl/contracts";

/** Where the sandbox puts the project inside Pyodide's virtual file system. */
export const PYTHON_PROJECT_DIR = "/project";

const FRAME_PATTERN = /^\s*File "\/project\/([^"]+)", line (\d+)/;

/**
 * The diagnostic for the last traceback in `stderr`, or null when there is none. The location is
 * the innermost frame inside the project; the message is the traceback's final line
 * (`ZeroDivisionError: division by zero`).
 */
export function parsePythonTraceback(stderr: string): CodeDiagnostic | null {
  const lines = stderr.split("\n");
  let start = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index].startsWith("Traceback (most recent call last):")) {
      start = index;
      break;
    }
  }
  // A SyntaxError in the entry file is printed without the "Traceback" header.
  const body = start === -1 ? lines : lines.slice(start + 1);

  let file: string | undefined;
  let line: number | undefined;
  let message: string | undefined;
  for (const text of body) {
    const frame = FRAME_PATTERN.exec(text);
    if (frame) {
      file = frame[1];
      line = Number(frame[2]);
    } else if (/^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt|Warning|Iteration)\b.*$/.test(text) || /^[A-Za-z_][\w.]*: /.test(text)) {
      // The last unindented "Name: text" line is the exception itself.
      message = text.trim();
    }
  }
  if (start === -1 && file === undefined) return null;
  if (message === undefined) return null;
  return { severity: "error", message, ...(file === undefined ? {} : { file, line }), source: "runtime" };
}
