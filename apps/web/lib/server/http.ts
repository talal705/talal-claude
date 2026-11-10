// Small helpers shared by the API services (execution, tutor). Server-only.

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/**
 * True for a request made by this site's own pages. Browsers send Origin on POST and DELETE and a
 * cross-site page cannot forge it; where Origin is absent, Sec-Fetch-Site must say same-origin.
 * `appOrigin` (NEXT_PUBLIC_APP_URL) is accepted in addition to the request's own host.
 */
export function isSameOrigin(request: Request, appOrigin?: string): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return request.headers.get("sec-fetch-site") === "same-origin";
  if (appOrigin !== undefined && origin === appOrigin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export function isJsonRequest(request: Request): boolean {
  return /^application\/json\b/i.test(request.headers.get("content-type") ?? "");
}

/** Reads the body as text, refusing to buffer more than `maxBytes`. Null when it is larger. */
export async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}
