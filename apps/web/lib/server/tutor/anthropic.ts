// The Anthropic provider: one Messages API request per hint set, through the official SDK.
// No tools are offered to the model and no conversation is kept. Server-only.
import Anthropic from "@anthropic-ai/sdk";
import { TutorProviderError, type TutorCompletion, type TutorCompletionRequest, type TutorProvider } from "./provider";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** How much reasoning the model spends. `null` sends no effort setting (for a model that does not accept one). */
  effort: AnthropicEffort | null;
  /** Ask the API to retry a request the model's safety classifiers declined on Anthropic's recommended fallback model. */
  refusalFallback: boolean;
  /** Replaces the network layer in tests. */
  fetch?: typeof fetch;
}

// Models whose API accepts `fallbacks: "default"`. For any other model the parameter is left out.
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toProviderError(error: unknown): TutorProviderError {
  if (error instanceof TutorProviderError) return error;
  // Most specific first.
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return new TutorProviderError("timeout", "the request to Anthropic was aborted or timed out");
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new TutorProviderError("auth", `Anthropic rejected the API key (${error.status})`);
  }
  if (error instanceof Anthropic.RateLimitError) return new TutorProviderError("rate_limited", "Anthropic rate limit reached");
  if (error instanceof Anthropic.NotFoundError || error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return new TutorProviderError("bad_request", `Anthropic rejected the request (${error.status}): ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError) return new TutorProviderError("unavailable", `could not connect to Anthropic: ${error.message}`);
  if (error instanceof Anthropic.APIError) return new TutorProviderError("unavailable", `Anthropic answered ${String(error.status)}`);
  return new TutorProviderError("unavailable", error instanceof Error ? error.message : String(error));
}

export function createAnthropicProvider(options: AnthropicProviderOptions): TutorProvider {
  // One retry for transient failures; the tutor's own timeout bounds the whole call.
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const useFallback = options.refusalFallback && SERVER_FALLBACK_MODELS.has(options.model);

  return {
    name: "anthropic",
    async complete(request: TutorCompletionRequest): Promise<TutorCompletion> {
      // Thinking is left at the model's default (adaptive). There is no `tools` field: the model can only write text.
      const params = {
        model: options.model,
        max_tokens: request.maxOutputTokens,
        system: [{ type: "text" as const, text: request.system, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: request.user }],
        output_config: {
          format: { type: "json_schema" as const, schema: request.schema },
          ...(options.effort === null ? {} : { effort: options.effort }),
        },
      };

      let message: Anthropic.Message | Anthropic.Beta.BetaMessage;
      try {
        message = useFallback
          ? await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, { signal: request.signal })
          : await client.messages.create(params, { signal: request.signal });
      } catch (error) {
        throw toProviderError(error);
      }

      const usage = {
        inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
      };
      // Checked before reading content: a refusal or a cut-off answer is not a hint set.
      if (message.stop_reason === "refusal") throw new TutorProviderError("refused", "the model declined to answer");
      if (message.stop_reason === "max_tokens") throw new TutorProviderError("invalid_output", "the answer was cut off at max_tokens");

      let text = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
      }
      try {
        return { json: JSON.parse(text), usage };
      } catch {
        throw new TutorProviderError("invalid_output", "the answer is not JSON");
      }
    },
  };
}


// Kept here for importers written before providers.ts existed (the root layout).
export { isTutorAiConfigured, providerFromEnv } from "./providers";
