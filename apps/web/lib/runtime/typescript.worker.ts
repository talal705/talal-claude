// The type checker's worker. It runs on the application's own origin: it is our code, and it only
// reads the learner's files as text; nothing of theirs is executed here.
// The compiler (about 9 MB) and its lib .d.ts files are fetched from /runtime/typescript/ on first use.
import type * as TS from "typescript-js";
import { CONSOLE_LIBS, checkAndEmit, referencedLibs, type TsCheckResult, type TsSourceFile } from "./ts-check";

declare function importScripts(...urls: string[]): void;
declare const ts: typeof TS | undefined;

export interface TsWorkerRequest {
  id: number;
  /** e.g. https://host/runtime/typescript/ */
  assetBase: string;
  files: TsSourceFile[];
}

export type TsWorkerResponse = { id: number; ok: true; result: TsCheckResult } | { id: number; ok: false; message: string };

const libs = new Map<string, string>();

/** Fetches the starting libs and everything they reference, once. */
async function loadLibs(assetBase: string): Promise<void> {
  const wanted: string[] = [...CONSOLE_LIBS];
  while (wanted.length > 0) {
    const batch = wanted.splice(0).filter((name) => !libs.has(name));
    const texts = await Promise.all(
      batch.map(async (name) => {
        const response = await fetch(assetBase + name);
        if (!response.ok) throw new Error(`could not load ${name} (${response.status})`);
        return response.text();
      }),
    );
    batch.forEach((name, index) => {
      libs.set(name, texts[index]);
      wanted.push(...referencedLibs(texts[index]));
    });
  }
}

self.onmessage = async (event: MessageEvent<TsWorkerRequest>) => {
  const { id, assetBase, files } = event.data;
  let response: TsWorkerResponse;
  try {
    // typescript.js defines the global `ts` when loaded as a classic script.
    if (typeof ts === "undefined") importScripts(`${assetBase}typescript.js`);
    await loadLibs(assetBase);
    response = { id, ok: true, result: checkAndEmit(ts as typeof TS, files, libs) };
  } catch (error) {
    response = { id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
