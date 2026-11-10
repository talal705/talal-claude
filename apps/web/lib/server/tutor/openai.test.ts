import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENAI_MODEL, isTutorAiConfigured, providerFromEnv } from "./providers";

const key = "sk-proj-test-only-0123456789abcdefghijklmnop";
afterEach(() => vi.unstubAllGlobals());

describe("first-party OpenAI configuration", () => {
  it("stays off without an actual key and refuses placeholder or Anthropic credentials", () => {
    for (const value of ["", "sk-...replace-me", "CHANGE_ME", "sk-ant-not-an-openai-key"]) {
      const env = { NODE_ENV: "test" as const, AI_PROVIDER: "openai", OPENAI_API_KEY: value };
      expect(isTutorAiConfigured(env)).toBe(false);
      expect(providerFromEnv(env)).toBeNull();
    }
  });
  it("uses the official endpoint, bounded structured response and server-only standard key", async () => {
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent = { url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"explanation":"Use log.","correctedCode":null,"line":1}' } }] }));
    });
    const env = { NODE_ENV: "test" as const, AI_PROVIDER: "openai", OPENAI_API_KEY: key, AI_BASE_URL: "https://unrelated.example/v1" };
    expect(isTutorAiConfigured(env)).toBe(true);
    const provider = providerFromEnv(env)!;
    expect(provider.name).toBe("openai");
    const result = await provider.complete({ system: "Review code.", user: "console.lg('Hi')", schema: { type: "object" }, maxOutputTokens: 5000, signal: new AbortController().signal });
    expect(sent!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent!.headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(sent!.body).toMatchObject({ model: DEFAULT_OPENAI_MODEL, store: false, reasoning_effort: "low", max_completion_tokens: 5000, response_format: { type: "json_schema" } });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it("keeps a user-selected model and supports the existing server-key variable", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }));
    });
    const provider = providerFromEnv({ NODE_ENV: "test", AI_PROVIDER: "openai", AI_API_KEY: key, AI_MODEL: "owner-selected-model", AI_OPENAI_REASONING_EFFORT: "medium" })!;
    await provider.complete({ system: "x", user: "y", schema: {}, maxOutputTokens: 20, signal: new AbortController().signal });
    expect(body).toMatchObject({ model: "owner-selected-model", reasoning_effort: "medium" });
  });
});
