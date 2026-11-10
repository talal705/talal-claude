// A provider for any server that speaks the OpenAI chat-completions protocol: OpenAI itself, other
// hosted services with a compatible endpoint, and local model servers (llama.cpp, vLLM, Ollama,
// LM Studio). Plain fetch, no SDK. One request per question; no tools, no conversation state.
// Field names follow the published OpenAI API specification (openai/openai-openapi).
import { TutorProviderError, type TutorCompletion, type TutorCompletionRequest, type TutorProvider } from "./provider";

export type ResponseFormatMode =
  /** `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. The default. */
  | "json_schema"
  /** `response_format: { type: "json_object" }` for servers without schema support; the shape is described in the prompt. */
  | "json_object"
  /** No `response_format` at all; the shape is described in the prompt. */
  | "none";

export interface OpenAICompatibleOptions {
  /** Base URL including the version path, e.g. `https://api.openai.com/v1` or `http://127.0.0.1:8080/v1`. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`. May be empty for a local server that needs none. */
  apiKey: string;
  model: string;
  responseFormat: ResponseFormatMode;
  /** OpenAI's current name is `max_completion_tokens`; many local servers only know `max_tokens`. */
  maxTokensField: "max_completion_tokens" | "max_tokens";
  /** Optional for older compatible servers; the first-party OpenAI configuration sets these. */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  store?: boolean;
  /** Replaces the network layer in tests. */
  fetch?: typeof fetch;
}

/** Added to the system prompt when the server cannot be given the schema itself. Fixed text. */
export const SHAPE_INSTRUCTION =
  '\n\nReply with only a JSON object, no other text, of exactly this shape: {"answer": string, "confidence": "certain" | "likely" | "possible", "target_id": string or null}.';

interface ChatCompletionResponse {
  choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** A model that ignores the format sometimes wraps JSON in a Markdown code fence. */
function unfence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

function statusError(status: number, detail: string): TutorProviderError {
  if (status === 401 || status === 403) return new TutorProviderError("auth", `the server rejected the API key (${status})`);
  if (status === 429) return new TutorProviderError("rate_limited", "the server's rate limit was reached");
  if (status === 400 || status === 404 || status === 422) return new TutorProviderError("bad_request", `the server rejected the request (${status}): ${detail}`);
  return new TutorProviderError("unavailable", `the server answered ${status}`);
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): TutorProvider {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const call = options.fetch ?? fetch;

  return {
    name: "openai_compatible",
    async complete(request: TutorCompletionRequest): Promise<TutorCompletion> {
      const describeShape = options.responseFormat !== "json_schema";
      const body: Record<string, unknown> = {
        model: options.model,
        messages: [
          // "system" rather than the newer "developer": every compatible server knows it.
          { role: "system", content: describeShape ? request.system + ((request.schema.properties as Record<string, unknown> | undefined)?.correctedCode ? `\n\nReturn only JSON matching this schema: ${JSON.stringify(request.schema)}` : SHAPE_INSTRUCTION) : request.system },
          { role: "user", content: request.user },
        ],
        [options.maxTokensField]: request.maxOutputTokens,
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        ...(options.store !== undefined ? { store: options.store } : {}),
      };
      if (options.responseFormat === "json_schema") {
        body.response_format = { type: "json_schema", json_schema: { name: "tutor_answer", strict: true, schema: request.schema } };
      } else if (options.responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
      }

      let response: Response;
      try {
        response = await call(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: request.signal,
          redirect: "error",
        });
      } catch (error) {
        if (request.signal.aborted) throw new TutorProviderError("timeout", "the request was aborted or timed out");
        throw new TutorProviderError("unavailable", `could not reach ${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (request.signal.aborted) throw new TutorProviderError("timeout", "the request was aborted or timed out");
        throw response.ok ? new TutorProviderError("invalid_output", "the server's answer is not JSON") : statusError(response.status, "no JSON body");
      }
      if (!response.ok) {
        const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
        throw statusError(response.status, typeof message === "string" ? message.slice(0, 300) : "no detail");
      }

      const completion = payload as ChatCompletionResponse;
      const choice = completion.choices?.[0];
      // Usage when reported; otherwise a rough count, so the daily budget still moves.
      const usage = {
        inputTokens: completion.usage?.prompt_tokens ?? Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: completion.usage?.completion_tokens ?? Math.ceil((choice?.message?.content?.length ?? 0) / 4),
      };
      if (!choice?.message) throw new TutorProviderError("invalid_output", "the answer has no message");
      if (typeof choice.message.refusal === "string" && choice.message.refusal !== "") throw new TutorProviderError("refused", "the model declined to answer");
      if (choice.finish_reason === "content_filter") throw new TutorProviderError("refused", "the answer was withheld by a content filter");
      if (choice.finish_reason === "length") throw new TutorProviderError("invalid_output", "the answer was cut off at the token limit");
      if (typeof choice.message.content !== "string") throw new TutorProviderError("invalid_output", "the answer has no text");
      try {
        return { json: JSON.parse(unfence(choice.message.content)), usage };
      } catch {
        throw new TutorProviderError("invalid_output", "the answer is not JSON");
      }
    },
  };
}

/** True for http(s) URLs, and for a loopback host, where a local model server may need no key. */
export function parseBaseUrl(value: string | undefined): { url: string; local: boolean } | null {
  try {
    const url = new URL((value ?? "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // Plain http only to this machine: a key must not cross a network unencrypted.
    if (url.protocol === "http:" && !local) return null;
    return { url: url.toString(), local };
  } catch {
    return null;
  }
}
