// Collects a program's output under a byte cap per stream.
import type { OutputChunk } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class OutputCollector {
  private readonly parts: Record<OutputChunk["stream"], string[]> = { stdout: [], stderr: [] };
  private readonly bytes: Record<OutputChunk["stream"], number> = { stdout: 0, stderr: 0 };
  readonly truncated: Record<OutputChunk["stream"], boolean> = { stdout: false, stderr: false };
  private readonly maxBytes: number;
  private readonly onOutput?: (chunk: OutputChunk) => void;

  constructor(maxBytes: number, onOutput?: (chunk: OutputChunk) => void) {
    this.maxBytes = maxBytes;
    this.onOutput = onOutput;
  }

  /**
   * Adds text to a stream. Returns false when the cap was passed: the part that fits is kept, the
   * stream is marked truncated, and the caller must end the run.
   */
  append(stream: OutputChunk["stream"], text: string): boolean {
    if (this.truncated[stream]) return false;
    const encoded = encoder.encode(text);
    const room = this.maxBytes - this.bytes[stream];
    let kept = text;
    if (encoded.length > room) {
      // A cut can split a multi-byte character; drop the replacement character that leaves.
      kept = decoder.decode(encoded.subarray(0, room)).replace(/�+$/, "");
      this.truncated[stream] = true;
    }
    if (kept.length > 0) {
      this.parts[stream].push(kept);
      this.bytes[stream] += encoder.encode(kept).length;
      this.emit({ stream, text: kept });
    }
    return !this.truncated[stream];
  }

  text(stream: OutputChunk["stream"]): string {
    return this.parts[stream].join("");
  }

  private emit(chunk: OutputChunk): void {
    try {
      this.onOutput?.(chunk);
    } catch (error) {
      // A faulty listener in the UI must not break the run.
      console.error(error);
    }
  }
}
