// Which provider the environment configures. The tutor service only sees the TutorProvider interface.
//   AI_PROVIDER=anthropic           the Claude API, through the official SDK (anthropic.ts)
//   AI_PROVIDER=openai              OpenAI's official API (OPENAI_API_KEY, optional AI_MODEL)
//   AI_PROVIDER=openai_compatible   any OpenAI chat-completions server, hosted or local (openai-compatible.ts)
//   AI_PROVIDER=fake                deterministic stand-in for browser checks; only with YTL_DEV_PAGES=1 (fake.ts)
import { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider, type AnthropicEffort } from "./anthropic";
import { createFakeProvider } from "./fake";
import { createOpenAICompatibleProvider, parseBaseUrl } from "./openai-compatible";
import type { TutorProvider } from "./provider";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

function openAiKey(env: NodeJS.ProcessEnv): string {
  const key = (env.OPENAI_API_KEY || env.AI_API_KEY || "").trim();
  return key.startsWith("sk-...") || key.startsWith("CHANGE_ME") || key.startsWith("sk-ant-") ? "" : key;
}

/** The provider configured by AI_PROVIDER, AI_API_KEY and AI_MODEL, or null when none is. */
export function providerFromEnv(env: NodeJS.ProcessEnv): TutorProvider | null {
  const name = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (name === "") return null;
  if (name === "openai") {
    const apiKey = openAiKey(env);
    if (!apiKey) return null;
    const effort = (env.AI_OPENAI_REASONING_EFFORT ?? "low").trim();
    const allowed = ["none", "low", "medium", "high", "xhigh", "max"] as const;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1", apiKey,
      model: (env.AI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL,
      responseFormat: "json_schema", maxTokensField: "max_completion_tokens", store: false,
      reasoningEffort: allowed.includes(effort as typeof allowed[number]) ? effort as typeof allowed[number] : "low",
    });
    return { ...provider, name: "openai" };
  }
  if (name === "fake") {
    // Only for browser checks on a development or test server; a normal installation cannot turn it on by accident.
    if (env.YTL_DEV_PAGES === "1") return createFakeProvider();
    console.error('tutor: AI_PROVIDER="fake" needs YTL_DEV_PAGES=1; the AI tutor stays off.');
    return null;
  }
  if (name === "openai_compatible") {
    const base = parseBaseUrl(env.AI_BASE_URL);
    const model = (env.AI_MODEL ?? "").trim();
    const apiKey = (env.AI_API_KEY ?? "").trim();
    if (!base || model === "" || (apiKey === "" && !base.local)) {
      console.error("tutor: AI_PROVIDER=openai_compatible needs AI_BASE_URL (https, or http to this machine), AI_MODEL, and AI_API_KEY unless the server is local; the AI tutor stays off.");
      return null;
    }
    const format = (env.AI_RESPONSE_FORMAT ?? "json_schema").trim().toLowerCase();
    return createOpenAICompatibleProvider({
      baseUrl: base.url,
      apiKey,
      model,
      responseFormat: format === "json_object" || format === "none" ? format : "json_schema",
      maxTokensField: (env.AI_MAX_TOKENS_FIELD ?? "").trim() === "max_tokens" ? "max_tokens" : "max_completion_tokens",
    });
  }
  if (name !== "anthropic") {
    console.error(`tutor: AI_PROVIDER="${name}" is not a provider this server implements; the AI tutor stays off.`);
    return null;
  }
  const apiKey = (env.AI_API_KEY ?? "").trim();
  if (apiKey === "" || apiKey.startsWith("sk-...")) {
    console.error("tutor: AI_PROVIDER is set but AI_API_KEY is not; the AI tutor stays off.");
    return null;
  }
  const effort = (env.AI_EFFORT ?? "low").trim().toLowerCase();
  const efforts: readonly string[] = ["low", "medium", "high", "xhigh", "max"];
  return createAnthropicProvider({
    apiKey,
    model: (env.AI_MODEL ?? "").trim() || DEFAULT_ANTHROPIC_MODEL,
    effort: effort === "off" ? null : efforts.includes(effort) ? (effort as AnthropicEffort) : "low",
    // Off unless asked for: it is a beta feature and sends a beta header.
    refusalFallback: (env.AI_REFUSAL_FALLBACK ?? "").trim().toLowerCase() === "on",
    fetch: undefined,
  });
}

/** Whether an AI provider is configured, read from the environment only. Nothing is contacted. */
export function isTutorAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const name = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (name === "openai") return openAiKey(env) !== "";
  if (name === "fake") return env.YTL_DEV_PAGES === "1";
  const apiKey = (env.AI_API_KEY ?? "").trim();
  if (name === "openai_compatible") {
    const base = parseBaseUrl(env.AI_BASE_URL);
    return base !== null && (env.AI_MODEL ?? "").trim() !== "" && (apiKey !== "" || base.local);
  }
  return name === "anthropic" && apiKey !== "" && !apiKey.startsWith("sk-...");
}
