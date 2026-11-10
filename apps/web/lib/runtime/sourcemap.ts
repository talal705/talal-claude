// Minimal source-map reader: maps a position in emitted JavaScript back to the TypeScript source.
// Only what the TypeScript compiler emits is handled (version 3, one source per file is typical).

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes one comma-separated segment of base64 VLQ numbers. */
export function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    if (digit === -1) throw new Error(`invalid source map character "${char}"`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

export interface OriginalPosition {
  source: string;
  /** 1-based. */
  line: number;
  column: number;
}

interface Segment {
  generatedColumn: number;
  source: number;
  line: number;
  column: number;
}

export type SourceMapLookup = (line: number, column?: number) => OriginalPosition | null;

/**
 * Returns a lookup from a generated position (1-based line and column) to the original one.
 * Without a column, the first mapping of the line is used. Returns null where nothing maps.
 */
export function createSourceMapLookup(mapJson: string): SourceMapLookup {
  let map: { sources?: unknown; mappings?: unknown };
  try {
    map = JSON.parse(mapJson);
  } catch {
    return () => null;
  }
  if (!Array.isArray(map.sources) || typeof map.mappings !== "string") return () => null;
  const sources = map.sources as string[];

  const lines: Segment[][] = [];
  let source = 0;
  let line = 0;
  let column = 0;
  try {
    for (const generatedLine of map.mappings.split(";")) {
      const segments: Segment[] = [];
      let generatedColumn = 0;
      for (const text of generatedLine.split(",")) {
        if (text === "") continue;
        const fields = decodeVlq(text);
        generatedColumn += fields[0];
        if (fields.length < 4) continue; // A segment without a source position.
        source += fields[1];
        line += fields[2];
        column += fields[3];
        segments.push({ generatedColumn, source, line, column });
      }
      lines.push(segments);
    }
  } catch {
    return () => null;
  }

  return (generatedLine, generatedColumn) => {
    const segments = lines[generatedLine - 1];
    if (!segments || segments.length === 0) return null;
    let match = segments[0];
    if (generatedColumn !== undefined) {
      for (const segment of segments) {
        if (segment.generatedColumn <= generatedColumn - 1) match = segment;
        else break;
      }
    }
    const name = sources[match.source];
    return typeof name === "string" ? { source: name, line: match.line + 1, column: match.column + 1 } : null;
  };
}
