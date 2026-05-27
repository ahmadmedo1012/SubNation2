/**
 * Flexible inventory-paste parser.
 *
 * Single source of truth for "what does the operator mean by this paste?".
 * Lives in the frontend so the UI can preview parse results live; the
 * backend uses the same shape via the exported types so the wire
 * contract stays consistent.
 *
 * The parser auto-detects the separator AND the column count per line,
 * because real-world pastes mix formats:
 *
 *   netflix1@mail.com|Pass123              → 2 cols (email + password)
 *   netflix2@mail.com,Pass456,2FA-disabled → 3 cols (email + password + extra)
 *   xbox-12345-ABCDE                       → 1 col  (code-only — Xbox / Steam)
 *   user@x.com\tPass\t/path/to/profile     → 3 cols (TSV from Sheets)
 *   {"email":"a@b.com","password":"p"}     → JSON   (advanced operators)
 *
 * Why this is needed: the previous parser hard-required ≥2 columns per
 * line which silently dropped every code-only product (Xbox Game Pass
 * keys, Steam wallet codes, gift cards). Operators were copy-pasting
 * 100 codes and seeing 'لا توجد بيانات صالحة' because the parser
 * couldn't see them.
 */

/**
 * The kind of inventory entry the parser detected.
 *
 *   "credentials"   → email + password [+ optional extra]
 *   "code"          → single-column code/key, stored in extra_details
 *                     (account_email + account_password stay null —
 *                     matches the inventory schema's optional columns)
 */
export type InventoryEntryKind = "credentials" | "code";

/** A successfully-parsed inventory row, ready for /api/admin/products/:id/inventory. */
export interface ParsedInventoryEntry {
  kind: InventoryEntryKind;
  /** account_email — populated only for kind=credentials. */
  email?: string;
  /** account_password — populated only for kind=credentials. */
  password?: string;
  /** extra_details — for kind=code this holds the code itself. */
  extra?: string;
}

/** A single line that failed to parse. The UI surfaces these as warnings. */
export interface InventoryParseError {
  /** 1-based source line number. */
  line: number;
  /** Original raw text the operator pasted (trimmed). */
  raw: string;
  /** Why we rejected the line. */
  reason: string;
}

export interface InventoryParseResult {
  entries: ParsedInventoryEntry[];
  errors: InventoryParseError[];
  /** Indices in `entries` flagged as duplicate-of-an-earlier-line. */
  duplicateIndices: number[];
  /** Total non-empty lines we processed. */
  totalLines: number;
}

const SEPARATORS = ["\t", "|", ";", ","] as const;

/**
 * Detect the most likely separator for a line. Picks the first separator
 * (in priority order) that produces ≥2 fields. Falls back to "" for
 * single-column lines.
 */
function detectSeparator(line: string): string {
  for (const sep of SEPARATORS) {
    if (line.includes(sep)) {
      const fieldCount = line.split(sep).filter((f) => f.trim()).length;
      if (fieldCount >= 2) return sep;
    }
  }
  return "";
}

/** Strip surrounding quotes some users paste from spreadsheets. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Try to parse a single non-empty trimmed line. */
function parseLine(line: string): ParsedInventoryEntry | { error: string } {
  // 1. Try JSON first — operators sometimes paste JSON-Lines from a
  //    password manager export.
  if (line.startsWith("{") && line.endsWith("}")) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const email = pickStringField(obj, ["email", "account_email", "user", "username"]);
      const password = pickStringField(obj, ["password", "account_password", "pass", "pwd"]);
      const code = pickStringField(obj, ["code", "key"]);
      const extra =
        pickStringField(obj, ["extra", "extra_details", "details", "note", "notes"]) ||
        undefined;

      if (email && password) {
        return { kind: "credentials", email, password, extra };
      }
      if (code) {
        return { kind: "code", extra: code };
      }
      return { error: "JSON يفتقد إلى email+password أو code" };
    } catch {
      return { error: "JSON غير صالح" };
    }
  }

  // 2. Tabular split — auto-detect separator.
  const separator = detectSeparator(line);
  if (separator === "") {
    // Single-column line → treat as a code/key.
    const code = unquote(line);
    if (!code) return { error: "السطر فارغ" };
    return { kind: "code", extra: code };
  }

  const parts = line.split(separator).map(unquote);
  const nonEmpty = parts.filter((p) => p.length > 0);

  if (nonEmpty.length === 1) {
    return { kind: "code", extra: nonEmpty[0] };
  }
  if (nonEmpty.length >= 2) {
    const email = nonEmpty[0];
    const password = nonEmpty[1];
    if (!email || !password) {
      return { error: "البريد أو كلمة المرور فارغ" };
    }
    const extra = nonEmpty.slice(2).join(" | ").trim() || undefined;
    return { kind: "credentials", email, password, extra };
  }
  return { error: "تعذّر تحليل السطر" };
}

function pickStringField(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Build a stable canonical key for dedup detection. Matches by:
 *   - kind=credentials → email (case-insensitive)
 *   - kind=code        → the code itself (case-insensitive)
 */
function dedupKey(entry: ParsedInventoryEntry): string {
  if (entry.kind === "credentials") {
    return `c:${(entry.email ?? "").toLowerCase()}`;
  }
  return `k:${(entry.extra ?? "").toLowerCase()}`;
}

/**
 * Parse a multi-line paste into inventory entries.
 *
 * @param raw           The full text from the textarea / dropped file.
 * @param existingKeys  Optional set of dedup keys already in the DB.
 *                      When supplied, duplicates against the existing
 *                      inventory get flagged just like in-paste dups.
 */
export function parseInventoryText(
  raw: string,
  existingKeys?: ReadonlySet<string>,
): InventoryParseResult {
  const result: InventoryParseResult = {
    entries: [],
    errors: [],
    duplicateIndices: [],
    totalLines: 0,
  };
  const seen = new Map<string, number>(); // dedup key → first index
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // blank lines silently dropped
    if (line.startsWith("#") || line.startsWith("//")) continue; // comment lines

    result.totalLines++;
    const parsed = parseLine(line);
    if ("error" in parsed) {
      result.errors.push({
        line: i + 1,
        raw: line.length > 80 ? line.slice(0, 80) + "…" : line,
        reason: parsed.error,
      });
      continue;
    }

    const key = dedupKey(parsed);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      // Duplicate within the paste — record but still include the entry
      // so the UI can let the operator decide whether to deduplicate.
      result.duplicateIndices.push(result.entries.length);
    } else if (existingKeys?.has(key)) {
      result.duplicateIndices.push(result.entries.length);
    } else {
      seen.set(key, result.entries.length);
    }
    result.entries.push(parsed);
  }
  return result;
}

/**
 * Build a Set of dedup keys for inventory rows already in the DB.
 * Used by the UI to flag duplicates against the existing inventory
 * before submission. Backend rebuilds the same keys to enforce.
 */
export function buildExistingDedupKeys(
  rows: Array<{
    accountEmail?: string | null;
    extraDetails?: string | null;
  }>,
): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.accountEmail) keys.add(`c:${r.accountEmail.toLowerCase()}`);
    if (r.extraDetails && !r.accountEmail) keys.add(`k:${r.extraDetails.toLowerCase()}`);
  }
  return keys;
}
