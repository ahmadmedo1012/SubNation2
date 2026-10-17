import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function loadEnvFile(filePath: string, protectedKeys: Set<string>): void {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (protectedKeys.has(key)) continue;
    const value = parseEnvValue(rawValue);
    if (value === "") continue;
    process.env[key] = value;
  }
}

const protectedKeys = new Set(Object.keys(process.env));
for (const filePath of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "config", ".env"),
  path.resolve(process.cwd(), "..", "config", ".env"),
]) {
  loadEnvFile(filePath, protectedKeys);
}

/**
 * R158 (B#7) — the shared numeric env-tunable reader.
 *
 * Nine call sites hand-rolled `Number(process.env.X)` + a silent
 * finite/positive guard, so a SET-but-malformed value ("25 000", "25s")
 * was indistinguishable from unset: the default answered with no boot
 * signal, and a typo'd ops override silently did nothing. The helper
 * keeps every call site's numeric semantics (each passes its own
 * predicate) and adds the one missing thing — a warn log naming the
 * variable on the set-but-unusable path.
 *
 * Contract:
 *   - unset or set-but-blank ("X=") answers the fallback SILENTLY —
 *     blank is the common comment-out shape, not a misconfiguration
 *     (the .env loader above skips blanks the same way);
 *   - set and parseable and isValid(value) → the parsed value;
 *   - set but NaN / rejected by the predicate → ONE warn + fallback.
 *
 * Note: parsing is strict `Number()` semantics. The one intentional
 * strictness change vs a former `parseInt` site (GRACEFUL_SHUTDOWN_
 * TIMEOUT_MS): a value like "25 000" used to partial-parse to 25ms and
 * silently clamp to 1s; it now warns and answers the 25s default.
 */
export function readEnvNumber(
  name: string,
  fallback: number,
  isValid: (value: number) => boolean = Number.isFinite,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!isValid(parsed)) {
    logger.warn(
      { name, fallback },
      `[env] ${name} is set but not a usable number — using the default ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}
