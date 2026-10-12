#!/usr/bin/env -S npx tsx
/**
 * ErrorCode YAML ↔ const sync gate (R135 — SH-1).
 *
 * Background: the ErrorCode enum is maintained in TWO places — the
 * round-3 single source of truth shared/error-codes/src/index.ts (the
 * const object backend and frontend both re-export) and the
 * `ErrorCode:` schema enum in shared/api-spec/openapi.yaml
 * (components/schemas, ~line 5465). The repo's own history documents
 * THREE drift incidents that predate this gate, each found by hand:
 *   - round-3: the CONFLICT/INVALID_TOKEN/FEATURE_DISABLED lag — the
 *     incident that created the shared package in the first place;
 *   - round-92 B3/F-05: the 14-code copilot preview/execution family
 *     existed in NEITHER the enum nor the spec while the routes emitted
 *     it ("the enum contract was a lie for that family");
 *   - round-93/94 (93-A8 F-8/F-15, A5-05): COPILOT_RATE_LIMITED,
 *     CSRF_CONFIG, COPILOT_PHASE_DISABLED, COPILOT_SECRET_LEAK landed
 *     outside the contract — the "enum must stay exhaustive over what
 *     the backend actually emits" class.
 * Nothing asserted the two lists stayed equal. This script is that CI
 * tripwire.
 *
 * Responsibilities:
 *   1. Parse the `ErrorCode:` enum block out of openapi.yaml with the
 *      same dependency-free line scan check-openapi-routes.ts uses:
 *      find the 4-space `ErrorCode:` schema key, then the 6-space
 *      `enum:` line, then collect the 8-space `- VALUE` entries until
 *      the block ends. The interleaved `# ...` annotation lines (the
 *      round-93/94 comment groups inside the block) and blank lines are
 *      skipped; sanity checks fail loudly if the format ever drifts.
 *   2. Import the const object DIRECTLY from the TS source
 *      (../shared/error-codes/src/index.ts — tsx runs it, and a
 *      package-name import would need @workspace/error-codes added as
 *      a scripts dependency + a lockfile bump, so the relative import
 *      keeps this gate install-free) and take Object.values(ErrorCode)
 *      as the authoritative list. A line scan of the same file maps
 *      each value to its source line so failure output cites
 *      file:line on the const side exactly like the YAML side.
 *   3. Diff BOTH directions:
 *        - in-YAML-not-in-const → FAILURE: the spec of record promises
 *          a code the typed contract doesn't know — generated clients
 *          type it while the backend/frontend switches and the Arabic
 *          message map can't produce it;
 *        - in-const-not-in-YAML → FAILURE: the backend can emit a code
 *          the spec omits — exactly the round-92/93/94 drift class.
 *      An out-of-sequence-but-equal pair is a non-failing ⚠️ (pnpm
 *      codegen output follows the enum order, so keep the sequences
 *      identical for reviewable diffs).
 *   4. Exit 0 with the synced count, or exit 1 with every offending
 *      value at its file:line and the remediation hint.
 *
 * Usage:
 *     npx tsx scripts/check-error-code-sync.ts          # from repo root
 *     pnpm --filter @workspace/scripts run check:error-codes
 *     CHECK_ERROR_CODE_SYNC_YAML=/tmp/doctored.yaml npx tsx scripts/check-error-code-sync.ts
 *
 * When you add a NEW error code you must touch BOTH sides in the same
 * commit: shared/error-codes/src/index.ts (the const) AND the
 * openapi.yaml ErrorCode enum (+ `pnpm codegen` to regenerate the
 * typed clients). Never delete an entry from one side only — that is
 * the round-3 single-source decision, enforced here since R135.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCode } from "../shared/error-codes/src/index.ts";

// ── Configuration ────────────────────────────────────────────────────────────

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REL_CONST = "shared/error-codes/src/index.ts";

// R135 (SH-1): optional YAML override — used ONLY to prove this gate's
// failure modes on a doctored COPY (shared/ is untouchable while sibling
// agents work in parallel); CI and local runs never set it.
const openApiPath =
  process.env.CHECK_ERROR_CODE_SYNC_YAML ??
  path.join(repoRoot, "shared", "api-spec", "openapi.yaml");
const constPath = path.join(repoRoot, "shared", "error-codes", "src", "index.ts");

/** Repo-relative display path for messages (absolute for /tmp overrides). */
function displayPath(p: string): string {
  const rel = path.relative(repoRoot, p);
  return rel.startsWith("..") ? p : rel;
}

// ── OpenAPI side: line-based ErrorCode enum scan ─────────────────────────────

interface YamlEntry {
  value: string;
  line: number; // 1-based, for the failure output
}

/**
 * Extract the `ErrorCode:` schema enum from openapi.yaml. Same contract
 * as parseOpenApiOps() in check-openapi-routes.ts: no YAML dependency —
 * the file's uniform 2/4/6/8-space indentation makes a line scan
 * reliable, and the sanity checks below fail loudly instead of silently
 * reporting zero entries if that ever stops being true.
 */
function parseOpenApiErrorCodeEnum(): { entries: YamlEntry[]; keyLine: number } {
  if (process.env.CHECK_ERROR_CODE_SYNC_YAML !== undefined && !existsSync(openApiPath)) {
    throw new Error(
      `CHECK_ERROR_CODE_SYNC_YAML points at ${openApiPath}, which does not exist — ` +
        "fix the override or unset it (CI never sets it).",
    );
  }
  const src = readFileSync(openApiPath, "utf8");
  const lines = src.split("\n");

  // The 4-space `ErrorCode:` schema key under components/schemas. The
  // `$ref: "#/components/schemas/ErrorCode"` mentions elsewhere in the
  // file never match this anchored form.
  let keyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^ {4}ErrorCode:\s*$/.test(lines[i])) {
      keyIdx = i;
      break;
    }
  }
  if (keyIdx === -1) {
    throw new Error(
      `${displayPath(openApiPath)}: no 4-space \`ErrorCode:\` schema key found — the scanner ` +
        "expects it under components/schemas with the file's uniform indentation. If the schema " +
        "was renamed or moved, update parseOpenApiErrorCodeEnum() in scripts/check-error-code-sync.ts.",
    );
  }

  // The 6-space `enum:` property must follow before the next 4-space
  // sibling schema. `type: string` and friends are skipped; an inline
  // flow-style `enum: [A, B]` would defeat the line scan, so it lands
  // here as a loud failure instead of a silent zero.
  let enumIdx = -1;
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^ {6}enum:\s*$/.test(line)) {
      enumIdx = i;
      break;
    }
    if (/^ {6}[A-Za-z][\w-]*:\s*\S/.test(line)) continue; // sibling property (type:, description:)
    break; // next 4-space schema — no block enum in this schema
  }
  if (enumIdx === -1) {
    throw new Error(
      `${displayPath(openApiPath)}:${keyIdx + 1}: found the ErrorCode schema but no block-style ` +
        "`enum:` line under it (inline `enum: [A, B]` flow style?). The line scanner needs the " +
        "one-value-per-line form — keep the block style or update " +
        "parseOpenApiErrorCodeEnum() in scripts/check-error-code-sync.ts.",
    );
  }

  // Collect the 8-space `- VALUE` entries until the block ends. Comment
  // lines at ANY indentation (the round-93/94 annotation groups inside
  // the block sit at 8-space, the trailing block summary at 4-space)
  // and blank lines carry no structure for this scan — skip them.
  const entries: YamlEntry[] = [];
  const seen = new Map<string, number>();
  for (let i = enumIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = /^ {8}- ([A-Za-z0-9_-]+)\s*(?:#.*)?$/.exec(line);
    if (!m) break; // any other content (the next 4-space schema key) ends the enum
    if (seen.has(m[1])) {
      throw new Error(
        `${displayPath(openApiPath)}: duplicate ErrorCode enum entry ${m[1]} ` +
          `(lines ${seen.get(m[1])} and ${i + 1}) — deduplicate before the sync gate can run.`,
      );
    }
    seen.set(m[1], i + 1);
    entries.push({ value: m[1], line: i + 1 });
  }

  // Sanity checks — mirror parseOpenApiOps(): fail loudly if the file's
  // format stops matching this scanner's assumptions instead of letting
  // an empty parse "pass" the gate vacuously.
  if (entries.length < 40) {
    throw new Error(
      `${displayPath(openApiPath)} scan found only ${entries.length} ErrorCode enum entries — ` +
        "expected ≥40. The file's indentation conventions likely changed; update " +
        "parseOpenApiErrorCodeEnum() in scripts/check-error-code-sync.ts.",
    );
  }
  if (!seen.has("INVALID_DATA")) {
    throw new Error(
      `${displayPath(openApiPath)} scan did not find INVALID_DATA in the ErrorCode enum — ` +
        "the scanner is broken.",
    );
  }
  return { entries, keyLine: keyIdx + 1 };
}

// ── Const side: Object.values + source-line map ──────────────────────────────

/**
 * Object.values(ErrorCode) is the authoritative list (imported above —
 * immune to source formatting). This scan only maps each value to its
 * const-file line so the failure output cites file:line on the const
 * side exactly like the YAML side; the consistency assertion below
 * fails loudly if the scan and the import ever disagree.
 */
function parseConstErrorCodes(): { values: readonly string[]; lines: Map<string, number> } {
  const values = Object.values(ErrorCode);
  const src = readFileSync(constPath, "utf8");
  const srcLines = src.split("\n");
  const byValue = new Map<string, number>();
  const entryRe = /^\s*[A-Za-z_$][\w$]*\s*:\s*"([A-Za-z0-9_-]+)"/;
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    // Doc comments and the trailing `export type` line never match, but
    // guard anyway — a commented-out entry must not become a "location".
    const trimmed = line.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
    const m = entryRe.exec(line);
    if (!m) continue;
    if (byValue.has(m[1])) {
      throw new Error(
        `${REL_CONST}: duplicate value "${m[1]}" (lines ${byValue.get(m[1])} and ${i + 1}) — ` +
          "two keys mapping to one code breaks Object.values-based consumers; fix the const.",
      );
    }
    byValue.set(m[1], i + 1);
  }

  // Sanity checks — same vacuous-pass protection as the YAML side.
  if (values.length < 40 || byValue.size < 40) {
    throw new Error(
      `${REL_CONST} scan found ${byValue.size} entries / Object.values(ErrorCode) yields ` +
        `${values.length} — expected ≥40 on both. The scanner (or the const) is broken; update ` +
        "parseConstErrorCodes() in scripts/check-error-code-sync.ts.",
    );
  }
  if (!values.includes("INVALID_DATA")) {
    throw new Error(
      `${REL_CONST}: Object.values(ErrorCode) lacks INVALID_DATA — scanner is broken.`,
    );
  }
  if (byValue.size !== values.length || values.some((v) => !byValue.has(v))) {
    throw new Error(
      `${REL_CONST}: line scan found ${byValue.size} entries but Object.values(ErrorCode) ` +
        `yields ${values.length} — the const's formatting likely changed (computed key, ` +
        "non-literal value, template string?). Update the entryRe scan in " +
        "parseConstErrorCodes() in scripts/check-error-code-sync.ts.",
    );
  }
  return { values, lines: byValue };
}

// ── Diff + report ────────────────────────────────────────────────────────────

function main(): void {
  const { entries: yamlEntries, keyLine } = parseOpenApiErrorCodeEnum();
  const { values: constValues, lines: constLines } = parseConstErrorCodes();

  const yamlSet = new Set(yamlEntries.map((e) => e.value));
  const constSet = new Set(constValues);

  // Both drift directions, each entry carrying its file:line.
  const yamlOnly = yamlEntries.filter((e) => !constSet.has(e.value));
  const constOnly = constValues.filter((v) => !yamlSet.has(v));

  console.log("ErrorCode YAML ↔ const sync gate");
  console.log(
    `  openapi.yaml ErrorCode enum entries: ${yamlEntries.length} (${displayPath(openApiPath)}:${keyLine})`,
  );
  console.log(`  shared/error-codes const values:     ${constValues.length} (${REL_CONST})`);
  console.log("");

  if (yamlOnly.length > 0) {
    console.log("❌ In the openapi.yaml enum but NOT in the shared const:");
    for (const e of yamlOnly)
      console.log(`     ${e.value}  (${displayPath(openApiPath)}:${e.line})`);
    console.log("   → The spec of record promises a code the typed contract doesn't know:");
    console.log("     generated clients type it, but backend/frontend switches and the Arabic");
    console.log(`     message map can't produce it. Add it to the ErrorCode const in ${REL_CONST}`);
    console.log("     or remove it from the enum — never leave the two apart (the round-3");
    console.log("     single-source decision). Then rerun this gate.");
    console.log("");
  }

  if (constOnly.length > 0) {
    console.log("❌ In the shared const but NOT in the openapi.yaml enum:");
    for (const v of constOnly) console.log(`     ${v}  (${REL_CONST}:${constLines.get(v)})`);
    console.log("   → The backend can emit this code while the spec of record omits it — the");
    console.log("     round-92 B3/F-05 and round-93/94 drift class. Add it to the ErrorCode");
    console.log(`     enum in shared/api-spec/openapi.yaml (+ \`pnpm codegen\`), or remove it`);
    console.log("     from the const. Then rerun this gate.");
    console.log("");
  }

  if (yamlOnly.length === 0 && constOnly.length === 0) {
    // ⚠️ informational only (the route gate's warn-but-don't-fail pattern):
    // same MEMBERS, different sequence. `pnpm codegen` follows the enum
    // order, so positional drift shows up as noisy regenerated diffs.
    const orderDivergences: Array<{ index: number; yaml: string; constValue: string }> = [];
    for (let i = 0; i < constValues.length; i++) {
      if (yamlEntries[i]?.value !== constValues[i]) {
        orderDivergences.push({
          index: i,
          yaml: yamlEntries[i]?.value ?? "<none>",
          constValue: constValues[i],
        });
      }
    }
    if (orderDivergences.length > 0) {
      console.log("⚠️  Same codes on both sides but out of sequence (first divergences):");
      for (const d of orderDivergences.slice(0, 10)) {
        console.log(`     position ${d.index}: yaml has ${d.yaml}, const has ${d.constValue}`);
      }
      console.log("   → Not a failure — but resequence one side to match the other so the");
      console.log("     regenerated clients diff cleanly.");
      console.log("");
    }

    console.log(`✅ error-code sync OK (${constValues.length} codes) — the openapi.yaml ErrorCode`);
    console.log(`   enum and ${REL_CONST} agree in both directions.`);
  } else {
    process.exitCode = 1;
  }
}

main();
