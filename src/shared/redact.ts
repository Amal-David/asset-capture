const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "x-auth-token", "x-csrf-token", "x-amz-security-token"]);
const SENSITIVE_QUERY_KEYS = [/token/i, /key/i, /sig/i, /signature/i, /credential/i, /password/i, /passwd/i, /secret/i, /auth/i, /session/i, /^jwt$/i, /expires/i, /policy/i, /access[_-]?token/i, /api[_-]?key/i];
// High-confidence secret shapes that can hide in any free-text/value: JWTs and
// common provider key prefixes (Stripe, GitHub, Slack, Google, AWS access keys).
const SECRET_PATTERNS: Array<{ flag: string; re: RegExp }> = [
  { flag: "inline:jwt", re: /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+/g },
  { flag: "inline:provider-key", re: /\b(?:sk|pk|rk)_(?:live|test)_[a-zA-Z0-9]{8,}/g },
  { flag: "inline:github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { flag: "inline:slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { flag: "inline:google-key", re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { flag: "inline:aws-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g }
];

export interface RedactionResult<T> {
  value: T;
  flags: string[];
}

export function redactHeaders(headers?: Record<string, string>): RedactionResult<Record<string, string> | undefined> {
  if (!headers) return { value: undefined, flags: [] };
  const flags: string[] = [];
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
      flags.push(`header:${key}`);
    } else {
      redacted[key] = redactInlineSecrets(value, flags);
    }
  }
  return { value: redacted, flags: unique(flags) };
}

export function redactUrl(url: string): RedactionResult<string> {
  try {
    const parsed = new URL(url);
    const flags: string[] = [];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.some((matcher) => matcher.test(key))) {
        parsed.searchParams.set(key, "[REDACTED]");
        flags.push(`query:${key}`);
      }
    }
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      flags.push("credentials");
    }
    return { value: parsed.toString().replace(/%5BREDACTED%5D/gi, "[REDACTED]"), flags: unique(flags) };
  } catch {
    const flags: string[] = [];
    return { value: redactInlineSecrets(url, flags), flags: unique(flags) };
  }
}

export function redactInlineSecrets(value: string, flags: string[]): string {
  let output = value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, (_match, prefix) => {
      flags.push("inline:bearer");
      return `${prefix}[REDACTED]`;
    })
    .replace(/([?&](?:token|key|sig|signature|password|secret|auth|session|jwt|access[_-]?token|api[_-]?key)=)[^&\s]+/gi, (_match, prefix) => {
      flags.push("inline:query");
      return `${prefix}[REDACTED]`;
    });
  for (const { flag, re } of SECRET_PATTERNS) {
    output = output.replace(re, () => {
      flags.push(flag);
      return "[REDACTED]";
    });
  }
  return output;
}

const TEXT_LIKE = [/^text\//i, /json/i, /javascript/i, /ecmascript/i, /xml/i, /csv/i, /x-www-form-urlencoded/i, /vnd\.apple\.mpegurl/i, /dash\+xml/i, /\+xml/i];

export function isTextLikeMime(mime?: string): boolean {
  if (!mime) return false;
  const normalized = mime.split(";")[0]!.trim().toLowerCase();
  return TEXT_LIKE.some((pattern) => pattern.test(normalized));
}

// Redact high-confidence secrets inside a response BODY (JWTs, provider keys,
// bearer/query tokens). Used for export + text preview so captured bodies don't
// leak credentials the header/URL redaction never saw.
export function redactTextContent(text: string): RedactionResult<string> {
  const flags: string[] = [];
  const value = redactInlineSecrets(text, flags);
  return { value, flags: unique(flags) };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
