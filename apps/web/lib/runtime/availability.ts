// Which server tracks (C++, Java, C#) can run on this site, read once from GET /api/execute/health.
// A site deployed without the runner (no execution service configured) answers 500 there; its server
// tracks are then shown as unavailable instead of failing on every run.
import { SERVER_TRACKS, type CodeTrack, type ServerTrack } from "@ytl/contracts";

export type ServerAvailability = Record<ServerTrack, boolean>;

export function isServerTrack(track: CodeTrack): track is ServerTrack {
  return (SERVER_TRACKS as readonly CodeTrack[]).includes(track);
}

/** Reads the health endpoint's answer. Anything but a reachable runner with that toolchain counts as unavailable. */
export function availabilityFromHealth(status: number, body: unknown): ServerAvailability {
  const health = status === 200 && body && typeof body === "object" ? (body as { reachable?: unknown; toolchains?: unknown }) : null;
  const toolchains = health?.reachable === true && health.toolchains && typeof health.toolchains === "object"
    ? (health.toolchains as Partial<Record<ServerTrack, { available?: unknown }>>)
    : null;
  return Object.fromEntries(SERVER_TRACKS.map((track) => [track, toolchains?.[track]?.available === true])) as ServerAvailability;
}

/** `null` when the site could not be asked (offline, aborted): the tracks stay as they were and a run reports its own failure. */
export async function fetchServerAvailability(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<ServerAvailability | null> {
  try {
    const response = await fetchImpl("/api/execute/health", { cache: "no-store", credentials: "same-origin", signal });
    const body: unknown = await response.json().catch(() => null);
    return availabilityFromHealth(response.status, body);
  } catch {
    return null;
  }
}
