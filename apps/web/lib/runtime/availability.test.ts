import { describe, expect, it } from "vitest";
import { availabilityFromHealth, fetchServerAvailability, isServerTrack } from "./availability";

const NONE = { cpp: false, java: false, csharp: false };

describe("availabilityFromHealth", () => {
  it("marks every server track unavailable when the execution service is not configured", () => {
    expect(availabilityFromHealth(500, { error: { code: "server_misconfigured", message: "…" } })).toEqual(NONE);
  });

  it("marks every server track unavailable when the runner cannot be reached", () => {
    expect(availabilityFromHealth(200, { reachable: false })).toEqual(NONE);
  });

  it("follows each toolchain when the runner answers", () => {
    const body = { reachable: true, toolchains: { cpp: { available: true }, java: { available: false }, csharp: { available: true } }, limits: {} };
    expect(availabilityFromHealth(200, body)).toEqual({ cpp: true, java: false, csharp: true });
  });

  it("treats a missing or malformed answer as unavailable", () => {
    expect(availabilityFromHealth(200, null)).toEqual(NONE);
    expect(availabilityFromHealth(200, { reachable: true })).toEqual(NONE);
    expect(availabilityFromHealth(200, { reachable: true, toolchains: { cpp: { available: "yes" } } })).toEqual(NONE);
  });
});

describe("fetchServerAvailability", () => {
  it("asks the health endpoint without caching", async () => {
    let asked: [string, RequestInit | undefined] | null = null;
    const fake = (async (input: string, init?: RequestInit) => {
      asked = [input, init];
      return new Response(JSON.stringify({ error: { code: "server_misconfigured" } }), { status: 500 });
    }) as typeof fetch;
    expect(await fetchServerAvailability(fake)).toEqual(NONE);
    expect(asked![0]).toBe("/api/execute/health");
    expect(asked![1]?.cache).toBe("no-store");
  });

  it("answers null when the site cannot be asked", async () => {
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    expect(await fetchServerAvailability(offline)).toBeNull();
  });

  it("answers unavailable when the body is not JSON", async () => {
    const html = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    expect(await fetchServerAvailability(html)).toEqual(NONE);
  });
});

describe("isServerTrack", () => {
  it("separates server tracks from browser tracks", () => {
    expect(["cpp", "java", "csharp"].every((track) => isServerTrack(track as never))).toBe(true);
    expect(["javascript", "typescript", "python", "html_css"].some((track) => isServerTrack(track as never))).toBe(false);
  });
});
