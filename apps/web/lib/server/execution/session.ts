// Guest identity for the execution API: a random ID in a signed, HttpOnly cookie. It proves only
// "the same browser as before", which is what ties a job to the session that created it. Server-only.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ytl_guest";
const VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MIN_SECRET_LENGTH = 32;

/** Rejects a missing, short or placeholder secret. */
export function isUsableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH && !secret.startsWith("CHANGE_ME");
}

function sign(id: string, secret: string): string {
  // The cookie name and version are part of the signed text, so a value signed for another purpose never verifies here.
  return createHmac("sha256", secret).update(`${SESSION_COOKIE}.${VERSION}.${id}`).digest("base64url");
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** The session ID from a valid cookie, or null when there is none or its signature does not verify. */
export function readSession(request: Request, secret: string): string | null {
  const value = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!value) return null;
  const [version, id, signature, ...rest] = value.split(".");
  if (version !== VERSION || rest.length > 0 || !id || !signature || !ID_PATTERN.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export interface NewSession {
  id: string;
  /** Value for a Set-Cookie header. */
  setCookie: string;
}

export function createSession(secret: string, secure: boolean): NewSession {
  const id = randomBytes(16).toString("base64url");
  const attributes = [
    `${SESSION_COOKIE}=${VERSION}.${id}.${sign(id, secret)}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return { id, setCookie: attributes.join("; ") };
}

// Kept on globalThis so every service (and every hot reload in development) signs with one secret.
const globalForSession = globalThis as typeof globalThis & { __ytlSessionSecret?: string | null };

/**
 * The secret that signs guest sessions: SESSION_SECRET when usable. Without one, production gets
 * null (the API routes then refuse to work) and development gets a random secret for this process.
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isUsableSecret(env.SESSION_SECRET)) return env.SESSION_SECRET;
  if (globalForSession.__ytlSessionSecret !== undefined) return globalForSession.__ytlSessionSecret;
  if (env.NODE_ENV === "production") {
    console.error("session: SESSION_SECRET is missing, shorter than 32 characters or still the placeholder; the API routes that need a session are disabled.");
    return (globalForSession.__ytlSessionSecret = null);
  }
  console.warn("session: SESSION_SECRET is not set; using a temporary secret. Guest sessions will not survive a restart.");
  return (globalForSession.__ytlSessionSecret = randomBytes(32).toString("hex"));
}
