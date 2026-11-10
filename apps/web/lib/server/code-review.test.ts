import { describe, expect, it } from "vitest";
import { createCodeReviewService, validateReview } from "./code-review";
import type { TutorCompletionRequest, TutorProvider } from "./tutor/provider";
import { createOpenAICompatibleProvider } from "./tutor/openai-compatible";

const secret = "test-code-review-session-secret-at-least-32";
const good = { track: "javascript", locale: "ar", code: 'console.lg("Hi")', diagnostic: "TypeError: console.lg is not a function" };
function request(data: unknown = good, origin = "http://localhost:3001", cookie?: string) {
  return new Request("http://localhost:3001/api/code/review", { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
}

describe("code review boundary", () => {
  it("keeps code review usable as an honest unavailable response without a provider", async () => {
    expect(await (await createCodeReviewService(null, secret)(request())).json()).toEqual({ status: "not_configured" });
  });
  it("blocks cross-origin and oversized source before any provider call", async () => {
    let calls = 0;
    const provider: TutorProvider = { name: "test", async complete() { calls++; throw Error("must not call"); } };
    const service = createCodeReviewService(provider, secret);
    expect((await service(request(good, "https://another-site.test"))).status).toBe(403);
    expect((await service(request({ ...good, code: "a".repeat(12001) }))).status).toBe(400);
    expect((await service(request({ ...good, track: "shell" }))).status).toBe(400);
    expect(calls).toBe(0);
  });
  it("treats learner text as data, returns bounded advice, and caps repeated reviews", async () => {
    const sent: TutorCompletionRequest[] = [];
    const provider: TutorProvider = { name: "test", async complete(input) {
      sent.push(input);
      return { json: { explanation: "اسم الأمر هو log.", correctedCode: 'console.log("Hi")', line: 1 }, usage: { inputTokens: 10, outputTokens: 20 } };
    } };
    const service = createCodeReviewService(provider, secret);
    const first = await service(request());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "reviewed", review: { line: 1 } });
    expect(JSON.parse(sent[0].user).sourceCode).toBe(good.code);
    expect(sent[0].system).not.toContain(good.code);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    for (let i = 0; i < 3; i++) expect((await service(request(good, undefined, cookie))).status).toBe(200);
    expect((await service(request(good, undefined, cookie))).status).toBe(429);
    expect(sent).toHaveLength(4);
  });
  it("rejects malformed or out-of-source model references without applying code", async () => {
    expect(validateReview({ explanation: "x", correctedCode: "x", line: 50 }, good.code)).toBeNull();
    expect(validateReview({ explanation: "x", correctedCode: "x".repeat(12001), line: 1 }, good.code)).toBeNull();
    const provider: TutorProvider = { name: "test", async complete() { return { json: { answer: "wrong format" }, usage: { inputTokens: 1, outputTokens: 1 } }; } };
    expect((await createCodeReviewService(provider, secret)(request())).status).toBe(502);
  });
  it("returns unavailable on a provider failure without exposing secrets or stack traces", async () => {
    const provider: TutorProvider = { name: "test", async complete() { throw Error("private provider details"); } };
    const response = await createCodeReviewService(provider, secret)(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("describes the code-review shape for compatible providers without strict schemas", async () => {
    let system = "";
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:8080/v1", apiKey: "", model: "test", responseFormat: "json_object", maxTokensField: "max_tokens",
      fetch: async (_url, init) => {
        system = JSON.parse(init!.body as string).messages[0].content;
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ explanation: "Use log.", correctedCode: 'console.log("Hi")', line: 1 }) } }] }));
      },
    });
    const response = await createCodeReviewService(provider, secret)(request());
    expect(response.status).toBe(200);
    expect(system).toContain('"correctedCode"');
    expect(system).not.toContain('"confidence"');
  });
  it("redacts secret-looking code values and never overwrites the learner's original secret with a placeholder", async () => {
    const pastedKey = "sk-proj-test-only-0123456789abcdefghijklmnop";
    let sent = "";
    const provider: TutorProvider = { name: "test", async complete(input) {
      sent = input.user;
      return { json: { explanation: "Use log.", correctedCode: 'const token = "[redacted]"; console.log(token);', line: 1 }, usage: { inputTokens: 10, outputTokens: 10 } };
    } };
    const response = await createCodeReviewService(provider, secret)(request({ ...good, code: `const token = "${pastedKey}"; console.lg(token);`, diagnostic: `failed with ${pastedKey}` }));
    expect(sent).not.toContain(pastedKey);
    expect(sent).toContain("[redacted]");
    expect(await response.json()).toMatchObject({ status: "reviewed", review: { correctedCode: null, line: null } });
  });
});
