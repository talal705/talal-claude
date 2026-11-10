// Replaces things that look like secrets before learner text is sent to a provider. A learner
// can paste a real key into code; it must not leave this server. Pattern-based, so it is a
// safeguard and not a guarantee.

const REPLACEMENT = "[redacted]";

const PATTERNS: readonly { pattern: RegExp; replace: string }[] = [
  // PEM private keys, whole block.
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, replace: REPLACEMENT },
  // Provider key formats: Anthropic/OpenAI style, AWS access key IDs, GitHub, Slack, Google, Stripe.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: REPLACEMENT },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REPLACEMENT },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: REPLACEMENT },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: REPLACEMENT },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: REPLACEMENT },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replace: REPLACEMENT },
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: REPLACEMENT },
  // JSON Web Tokens.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: REPLACEMENT },
  // The password in a URL with credentials: scheme://user:password@host
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, replace: `$1:${REPLACEMENT}@` },
  // Authorization headers.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, replace: `$1 ${REPLACEMENT}` },
  // name = "value" where the name says it is a secret. The value is replaced, the name kept.
  {
    pattern: /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["'`]?)[^\s"'`,;)}\]\[]{8,}\3/gi,
    replace: `$1$2$3${REPLACEMENT}$3`,
  },
];

export interface Redacted {
  text: string;
  /** How many replacements were made. */
  count: number;
}

export function redactSecrets(text: string): Redacted {
  let count = 0;
  let result = text;
  for (const { pattern, replace } of PATTERNS) {
    const found = result.match(pattern);
    if (!found) continue;
    count += found.length;
    result = result.replace(pattern, replace);
  }
  return { text: result, count };
}
