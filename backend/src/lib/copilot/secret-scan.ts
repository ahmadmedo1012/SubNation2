/**
 * Outbound secret scanner for copilot responses and preview payloads
 * (010-ai-admin-copilot, T024 + research §R-14).
 *
 * The Pino redactor only protects log lines. This scanner protects the
 * data we actually return to admins — model responses, preview JSON, and
 * tool-call results — so a hallucinated credential never reaches the UI
 * even if it bypassed the validator (SC-008).
 */

interface ScanMatch {
  pattern: string;
  sample: string;
}

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "postgres_url", re: /postgres(?:ql)?:\/\/[^\s"'<>]{8,}/i },
  { name: "redis_url", re: /redis:\/\/[^\s"'<>]{8,}/i },
  { name: "aws_access_key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "aws_secret", re: /aws[_-]?secret[_-]?access[_-]?key[\s:=]+[A-Za-z0-9/+=]{30,}/i },
  { name: "bearer_token", re: /bearer\s+[A-Za-z0-9._+/=-]{20,}/i },
  { name: "anthropic_key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai_key", re: /sk-[A-Za-z0-9]{32,}/ },
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // The inventory password column: the value is encrypted in DB but a
  // hallucinated decrypt could surface plain text — guard the field name.
  { name: "account_password_field", re: /["']?account[_-]?password["']?\s*[:=]\s*["'][^"']+["']/i },
];

export interface ScanResult {
  hasMatch: boolean;
  matches: ScanMatch[];
}

/**
 * Scan a string or any JSON-encodable value. Recurses into objects/arrays.
 * Returns the FIRST match per pattern; do not log `sample` raw.
 */
export function scanForSecrets(input: unknown): ScanResult {
  const matches: ScanMatch[] = [];
  const text = typeof input === "string" ? input : safeStringify(input);
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) matches.push({ pattern: name, sample: redactSample(m[0]) });
  }
  return { hasMatch: matches.length > 0, matches };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function redactSample(s: string): string {
  if (s.length <= 8) return "[REDACTED]";
  return `${s.slice(0, 4)}…[REDACTED]…${s.slice(-2)}`;
}
