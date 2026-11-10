// The application's tutor service, built on first use from the environment. Server-only.
import { originOf } from "../http";
import { resolveSessionSecret } from "../session";
import { providerFromEnv } from "./providers";
import { DEFAULT_TUTOR_LIMITS, createTutorService, misconfigured, type TutorService } from "./service";

const globalForTutor = globalThis as typeof globalThis & { __ytlTutor?: TutorService | null };

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Null when the session secret is unusable in production. */
export function getTutorService(): TutorService | null {
  if (globalForTutor.__ytlTutor !== undefined) return globalForTutor.__ytlTutor;
  const sessionSecret = resolveSessionSecret();
  if (sessionSecret === null) return (globalForTutor.__ytlTutor = null);
  return (globalForTutor.__ytlTutor = createTutorService({
    provider: providerFromEnv(process.env),
    sessionSecret,
    appOrigin: originOf(process.env.NEXT_PUBLIC_APP_URL),
    ...DEFAULT_TUTOR_LIMITS,
    maxOutputTokens: positive(process.env.AI_MAX_OUTPUT_TOKENS, DEFAULT_TUTOR_LIMITS.maxOutputTokens),
    timeoutMs: positive(process.env.AI_TIMEOUT_MS, DEFAULT_TUTOR_LIMITS.timeoutMs),
  }));
}

export async function withTutorService(handler: (service: TutorService) => Response | Promise<Response>): Promise<Response> {
  const service = getTutorService();
  if (!service) return misconfigured();
  try {
    return await handler(service);
  } catch (error) {
    console.error("tutor: unexpected error", error);
    return misconfigured();
  }
}
