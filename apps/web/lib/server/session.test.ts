import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, createSession, isUsableSecret, readSession } from "./session";

const SESSION_SECRET = "session-secret-for-tests-0123456789abcdef";
const SITE = "http://localhost:3000";

describe("guest session cookie", () => {
  it("round-trips a signed session and rejects anything altered", () => {
    const session = createSession(SESSION_SECRET, true);
    expect(session.setCookie).toContain("; Secure");
    const cookie = session.setCookie.split(";")[0];
    const read = (value: string, secret = SESSION_SECRET) => readSession(new Request(SITE, { headers: { cookie: value } }), secret);

    expect(read(cookie)).toBe(session.id);
    expect(read(`ytl_locale=ar; ${cookie}; other=1`)).toBe(session.id);
    expect(read(cookie, "another-secret-0123456789abcdef-another")).toBeNull();
    const other = createSession(SESSION_SECRET, false);
    // Another session's ID with this session's signature.
    expect(read(cookie.replace(session.id, other.id))).toBeNull();
    expect(read(`${SESSION_COOKIE}=v2.${cookie.split(".").slice(1).join(".")}`)).toBeNull();
    expect(read(`${SESSION_COOKIE}=`)).toBeNull();
    expect(read("unrelated=1")).toBeNull();
    expect(readSession(new Request(SITE), SESSION_SECRET)).toBeNull();
  });

  it("accepts only a long, non-placeholder secret", () => {
    expect(isUsableSecret(SESSION_SECRET)).toBe(true);
    expect(isUsableSecret(undefined)).toBe(false);
    expect(isUsableSecret("x".repeat(31))).toBe(false);
    expect(isUsableSecret(`CHANGE_ME${"x".repeat(40)}`)).toBe(false);
  });
});
