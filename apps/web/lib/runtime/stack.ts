// Turns an uncaught error reported by a sandbox into text for stderr and a diagnostic with a
// file and line. The sandbox has already replaced each module's blob URL by `project:/<path>`.
import type { CodeDiagnostic } from "@ytl/contracts";

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
}

/** Maps a frame of the code that ran to a frame of the code the learner wrote. Null: leave as is. */
export type FrameMapper = (frame: StackFrame) => StackFrame | null;

const FRAME_PATTERN = /project:\/([^\s:()]+):(\d+)(?::(\d+))?/g;

/** Frames that point into project files, innermost first, as browsers list them. */
export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const match of stack.matchAll(FRAME_PATTERN)) {
    frames.push({ file: match[1], line: Number(match[2]), ...(match[3] === undefined ? {} : { column: Number(match[3]) }) });
  }
  return frames;
}

export interface RuntimeErrorReport {
  /** What a console would print: the error line, then one line per project frame. */
  text: string;
  diagnostic: CodeDiagnostic;
}

export function describeRuntimeError(
  error: { name: string; message: string; stack: string },
  mapFrame: FrameMapper = () => null,
): RuntimeErrorReport {
  const frames = parseStackFrames(error.stack).map((frame) => mapFrame(frame) ?? frame);
  const headline = error.name && error.message ? `${error.name}: ${error.message}` : error.message || error.name || "Error";
  const lines = [`Uncaught ${headline}`, ...frames.map((frame) => `    at ${frame.file}:${frame.line}${frame.column === undefined ? "" : `:${frame.column}`}`)];
  const top = frames[0];
  return {
    text: `${lines.join("\n")}\n`,
    diagnostic: {
      severity: "error",
      message: headline,
      ...(top ? { file: top.file, line: top.line, ...(top.column === undefined ? {} : { column: top.column }) } : {}),
      source: "runtime",
    },
  };
}
