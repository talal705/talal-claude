// The seam between the tutor and whichever model provider is configured. Server-only.

export interface TutorCompletionRequest {
  /** Fixed instructions. The same text on every request, so a provider can cache it. */
  system: string;
  /** The evidence for this request. Learner-written text appears only here, as data. */
  user: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface TutorCompletion {
  /** The provider's answer, parsed from JSON. Not yet trusted: the tutor validates it. */
  json: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

export type TutorProviderErrorCode =
  /** Network failure, overload or a server error at the provider. */
  | "unavailable"
  | "timeout"
  | "rate_limited"
  /** The key is missing, wrong or not allowed to use the model. */
  | "auth"
  /** The provider rejected the request as malformed (a bug on our side, or an unknown model name). */
  | "bad_request"
  /** The model declined to answer. */
  | "refused"
  /** The answer is not JSON, or was cut off. */
  | "invalid_output";

export class TutorProviderError extends Error {
  readonly code: TutorProviderErrorCode;
  constructor(code: TutorProviderErrorCode, message: string) {
    super(message);
    this.name = "TutorProviderError";
    this.code = code;
  }
}

/** No tools, no conversation state, no access to the project: text in, JSON out. */
export interface TutorProvider {
  /** Shown in the status route, e.g. `anthropic`. */
  readonly name: string;
  complete(request: TutorCompletionRequest): Promise<TutorCompletion>;
}
