#!/usr/bin/env -S npx tsx
/**
 * OpenAPI header-parameter survival gate (R142 — N-1).
 *
 * Background: the orval react-query client target DROPS every header
 * parameter the spec declares — all 7 of them at R142 (Idempotency-Key
 * on the six money mutations + the required x-telegram-bot-api-secret-
 * token on the Telegram webhook). The generated hooks therefore cannot
 * carry a per-purchase idempotency key at all, while the zod target
 * built from the SAME spec emits them happily (`CreateOrderHeader`
 * zod.object blocks in shared/api-zod) — the spec data reaches orval;
 * only the client target loses it. Nothing asserted any of this: a
 * future spec header param would silently vanish from the typed client
 * the day it is declared (exactly how N-1 shipped). This script is that
 * CI tripwire.
 *
 * Idempotency-Key escape-hatch contract (documented here because this
 * gate is its registry): until orval's react-query client target emits
 * header params into the generated signatures, per-call RequestInit
 * `headers` threaded through customFetch ARE the way money paths pass
 * Idempotency-Key — the six ledger rows below ARE that contract, and a
 * typed emission from orval would let them retire.
 *
 * Responsibilities:
 *   1. Enumerate the SPEC side: parse shared/api-spec/openapi.yaml with
 *      the same dependency-free line scan check-openapi-routes.ts uses
 *      (2-space path → 4-space method → 8-space `- name:` + 10-space
 *      `in: header`). Sanity checks fail loudly if the format drifts.
 *   2. Assert spec→codegen reachability: every spec header param must
 *      survive in the generated zod client (the quoted raw-name key
 *      `"Idempotency-Key":` inside a `*Header = zod.object` block), and
 *      the count of zod Header objects must equal the spec-side count
 *      (a $ref'd param the line scanner cannot see shows up as a count
 *      mismatch instead of a silent pass).
 *   3. Diff the react client against the KNOWN_DROPPED ledger, both
 *      directions:
 *        - dropped-but-not-ledgered → FAILURE: a spec header param
 *          silently vanished from the typed client (the N-1 class);
 *        - ledgered-but-now-emitted → FAILURE: the ledger is stale —
 *          orval started emitting the header, so retire the escape
 *          hatch row and route call sites through the typed signature;
 *        - ledgered-but-no-longer-in-spec → FAILURE: remove the row.
 *
 * Usage:
 *     npx tsx scripts/check-openapi-header-params.ts       # from repo root
 *     pnpm --filter @workspace/scripts run check:header-params
 *     CHECK_HEADER_PARAMS_YAML=/tmp/doctored.yaml npx tsx scripts/check-openapi-header-params.ts
 *
 * When you add a NEW header parameter to openapi.yaml you must, in the
 * same commit: run `pnpm codegen`, then either land its emission in the
 * react client or add a ledger row here with the reason — never let a
 * drop pass silently.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Configuration ────────────────────────────────────────────────────────────

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// R142 (N-1): optional YAML override — used ONLY to prove this gate's
// failure modes on a doctored COPY (shared/ is untouchable while sibling
// agents work in parallel); CI and local runs never set it.
const openApiPath =
  process.env.CHECK_HEADER_PARAMS_YAML ?? path.join(repoRoot, "shared", "api-spec", "openapi.yaml");
const zodClientPath = path.join(repoRoot, "shared", "api-zod", "src", "generated", "api.ts");
const reactClientDir = path.join(repoRoot, "shared", "api-client-react", "src", "generated");

/** Repo-relative display path for messages (absolute for /tmp overrides). */
function displayPath(p: string): string {
  const rel = path.relative(repoRoot, p);
  return rel.startsWith("..") ? p : rel;
}

// ── Spec side: line-based header-parameter scan ─────────────────────────────

interface SpecHeaderParam {
  method: string; // lowercase
  path: string; // template form: /admin/topups/{id}/approve
  header: string; // raw header name: Idempotency-Key
  line: number; // 1-based, for the failure output
}

/**
 * Extract every header parameter declared in openapi.yaml's paths block.
 * Same contract as parseOpenApiOps() in check-openapi-routes.ts: no YAML
 * dependency — the file's uniform 2/4/8/10-space indentation makes a line
 * scan reliable, and the sanity checks below fail loudly instead of
 * silently reporting zero params if that ever stops being true.
 */
function parseSpecHeaderParams(): SpecHeaderParam[] {
  if (process.env.CHECK_HEADER_PARAMS_YAML !== undefined && !existsSync(openApiPath)) {
    throw new Error(
      `CHECK_HEADER_PARAMS_YAML points at ${openApiPath}, which does not exist — ` +
        "fix the override or unset it (CI never sets it).",
    );
  }
  const src = readFileSync(openApiPath, "utf8");
  const lines = src.split("\n");

  const params: SpecHeaderParam[] = [];
  let inPaths = false;
  let currentPath: string | null = null;
  let currentMethod: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Blank/comment-only lines carry no structure for this scan.
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    if (/^paths:/.test(line)) {
      inPaths = true;
      currentPath = null;
      currentMethod = null;
      continue;
    }
    if (/^components:|^webhooks:|^tags:|^servers:/.test(line) && inPaths) {
      inPaths = false; // paths: block ended
      continue;
    }
    if (!inPaths) continue;

    const pathMatch = /^ {2}(\/\S*):/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = null;
      continue;
    }
    if (currentPath === null) continue;

    const methodMatch = /^ {4}(get|post|put|patch|delete|options|head):/.exec(line);
    if (methodMatch) {
      currentMethod = methodMatch[1];
      continue;
    }
    if (currentMethod === null) continue;

    // 8-space `- name: <HEADER>` inside the op's parameters list.
    const nameMatch = /^ {8}- name: ([A-Za-z0-9-]+)\s*$/.exec(line);
    if (!nameMatch) continue;
    // The `in:` discriminator sits on the next non-comment line (10-space).
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trimStart().startsWith("#"))) {
      j++;
    }
    if (!/^ {10}in: header\s*$/.test(lines[j] ?? "")) continue;
    params.push({
      method: currentMethod,
      path: currentPath,
      header: nameMatch[1],
      line: i + 1,
    });
  }

  // Sanity checks — fail loudly if the file's format stops matching this
  // scanner's assumptions instead of silently reporting zero params.
  if (params.length < 5) {
    throw new Error(
      `${displayPath(openApiPath)} scan found only ${params.length} header parameters — ` +
        "expected ≥5. The file's indentation conventions likely changed; update " +
        "parseSpecHeaderParams() in scripts/check-openapi-header-params.ts.",
    );
  }
  const moneyAnchor = params.some(
    (p) => p.method === "post" && p.path === "/orders" && p.header === "Idempotency-Key",
  );
  if (!moneyAnchor) {
    throw new Error(
      `${displayPath(openApiPath)} scan did not find Idempotency-Key on POST /orders — ` +
        "the scanner is broken (or the money-path contract moved).",
    );
  }
  return params;
}

// ── Generated sides ──────────────────────────────────────────────────────────

/**
 * The orval react-query target drops header params from the generated
 * client signatures; these rows are the documented escape-hatch contract
 * (per-call RequestInit headers through customFetch). A row must be
 * REMOVED the day the generated client starts emitting its header — the
 * gate fails on a stale row so that day cannot pass unnoticed.
 */
const KNOWN_DROPPED: ReadonlyArray<{ method: string; path: string; header: string }> = [
  { method: "post", path: "/orders", header: "Idempotency-Key" },
  { method: "patch", path: "/admin/orders/bulk-status", header: "Idempotency-Key" },
  { method: "post", path: "/admin/topups/{id}/approve", header: "Idempotency-Key" },
  { method: "post", path: "/admin/topups/{id}/reject", header: "Idempotency-Key" },
  { method: "post", path: "/admin/referrals/{id}/credit", header: "Idempotency-Key" },
  { method: "patch", path: "/admin/users/{id}", header: "Idempotency-Key" },
  { method: "post", path: "/webhook/telegram", header: "x-telegram-bot-api-secret-token" },
];

const reactClientFiles = ["api.ts", "api.schemas.ts"].map((f) => path.join(reactClientDir, f));

/**
 * Does the generated react client carry `header` as a typed param?
 * shortcut: matches the forms orval emits for params (camelCase property,
 * PascalCase type fragment, or the zod-style quoted raw key) — prose
 * mentions in copied JSDoc are unquoted/hyphenated and never match; if a
 * future orval uses another shape, the row reads as still-dropped (the
 * safe direction), so extend the alternation when that lands.
 */
function headerSurvivesInReactClient(header: string): boolean {
  // `-K` in Idempotency-Key is uppercase — the case-insensitive class is
  // what makes the camel transform actually fire for both live shapes.
  const camel = header.replace(/-([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  const re = new RegExp(`\\b${camel}\\b|\\b${pascal}\\b|"${header}"`);
  return reactClientFiles.some((f) => re.test(readFileSync(f, "utf8")));
}

// ── Diff + report ────────────────────────────────────────────────────────────

function main(): void {
  const specParams = parseSpecHeaderParams();
  const zodSrc = readFileSync(zodClientPath, "utf8");

  console.log("OpenAPI header-parameter survival gate");
  console.log(
    `  spec header params: ${specParams.length} (${displayPath(openApiPath)}:${specParams[0]?.line})`,
  );
  console.log(
    `  zod mirror Header objects: ${(zodSrc.match(/Header = zod\.object\(/g) ?? []).length}`,
  );
  console.log("");

  const failures: string[] = [];

  // 2. Spec → zod reachability: every spec header param must survive as a
  //    quoted raw-name key, and the zod Header-object count must equal the
  //    spec-side count (a $ref'd param the line scanner cannot see breaks
  //    the equality instead of passing vacuously).
  for (const p of specParams) {
    if (!zodSrc.includes(`"${p.header}"`)) {
      failures.push(
        `${p.header} on ${p.method.toUpperCase()} ${p.path} ` +
          `(${displayPath(openApiPath)}:${p.line}) does not survive codegen: no ` +
          `"${p.header}" key in ${displayPath(zodClientPath)} — the spec data no longer ` +
          "reaches orval; regenerate with `pnpm --filter @workspace/api-spec run codegen`.",
      );
    }
  }
  const zodHeaderObjects = (zodSrc.match(/Header = zod\.object\(/g) ?? []).length;
  if (zodHeaderObjects !== specParams.length) {
    failures.push(
      `zod client carries ${zodHeaderObjects} \`*Header = zod.object\` blocks but the spec scan ` +
        `found ${specParams.length} header params — a $ref'd or path-level parameter the line ` +
        "scanner cannot see? Extend parseSpecHeaderParams() in " +
        "scripts/check-openapi-header-params.ts.",
    );
  }

  // 3. React client ↔ ledger diff, both directions.
  for (const p of specParams) {
    const ledgered = KNOWN_DROPPED.some(
      (r) => r.method === p.method && r.path === p.path && r.header === p.header,
    );
    const emitted = headerSurvivesInReactClient(p.header);
    if (!emitted && !ledgered) {
      failures.push(
        `${p.header} on ${p.method.toUpperCase()} ${p.path} ` +
          `(${displayPath(openApiPath)}:${p.line}) is silently DROPPED by the generated react ` +
          "client and carries no KNOWN_DROPPED ledger row — the N-1 class. Either land its " +
          "emission in shared/api-client-react/src/generated or add a ledger row in " +
          "scripts/check-openapi-header-params.ts with the reason.",
      );
    } else if (emitted && ledgered) {
      failures.push(
        `${p.header} on ${p.method.toUpperCase()} ${p.path} is now EMITTED by the generated ` +
          "react client but still carries a KNOWN_DROPPED ledger row — retire the escape " +
          "hatch: remove the row and route call sites through the typed signature.",
      );
    }
  }
  for (const r of KNOWN_DROPPED) {
    if (
      !specParams.some((p) => p.method === r.method && p.path === r.path && p.header === r.header)
    ) {
      failures.push(
        `KNOWN_DROPPED row ${r.header} on ${r.method.toUpperCase()} ${r.path} no longer matches ` +
          "any spec header parameter — remove the stale row.",
      );
    }
  }

  if (failures.length > 0) {
    console.log("❌ Header-param survival drift:");
    for (const f of failures) console.log(`     ${f}`);
    console.log("");
    process.exitCode = 1;
    return;
  }

  const dropped = specParams.filter((p) =>
    KNOWN_DROPPED.some((r) => r.method === p.method && r.path === p.path && r.header === p.header),
  );
  console.log(
    `✅ header-param survival OK — ${specParams.length}/${specParams.length} spec header params ` +
      `reach the zod mirror; ${dropped.length} ride the documented RequestInit escape hatch ` +
      "(per-call headers through customFetch) until orval's client target emits them.",
  );
}

main();
