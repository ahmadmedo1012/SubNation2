import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * R187-3 — the OpenAPI spec-TRUTH pin suite.
 *
 * WHAT THIS CATCHES: error-path truth drift between openapi.yaml and the
 * backend implementations. The repo already machine-pins two of the
 * chain's three joints (spec↔generated via the orval drift gate;
 * ErrorCode registry via check-error-code-sync.ts) and the 2xx body
 * shapes via openapi-response-contracts.test.ts — but RESPONSE STATUS
 * SETS, header params, reason enums and route descriptions had no gate
 * below the route level (R187-I's audit: every cross-layer finding this
 * round lived exactly there). This suite is that gate for the R187-3
 * fixes: each `it` pins one documented finding so a regression (a
 * status arm dropped in a spec refactor, a header param removed, a
 * description reverting to a retired story) fails CI instead of
 * shipping silently.
 *
 * HOW: the same dependency-free line scan the sibling gates use
 * (check-openapi-routes.ts / check-error-code-sync.ts /
 * check-openapi-header-params.ts) — the file's uniform 2/4/6/8/10-space
 * indentation makes a line scan reliable, and the sanity checks below
 * fail loudly instead of silently passing if that ever stops being true.
 *
 * SPEC_TRUTH_YAML env override: used ONLY to prove this gate's failure
 * modes on a doctored COPY (shared/ is untouchable while sibling agents
 * work in parallel) — the same contract as CHECK_ERROR_CODE_SYNC_YAML.
 * CI and local runs never set it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const specPath =
  process.env.SPEC_TRUTH_YAML ?? path.join(repoRoot, "shared", "api-spec", "openapi.yaml");

const specLines: string[] = (() => {
  if (process.env.SPEC_TRUTH_YAML !== undefined && !existsSync(specPath)) {
    throw new Error(`SPEC_TRUTH_YAML points at ${specPath}, which does not exist.`);
  }
  return readFileSync(specPath, "utf8").split("\n");
})();

// ── Line-scan helpers (sibling-gate conventions) ─────────────────────────────

/** The lines of one operation block (2-space path → 4-space method). */
function opBlock(opPath: string, method: string): string[] {
  const lines: string[] = [];
  let inPaths = false;
  let currentPath: string | null = null;
  let capturing = false;
  for (const line of specLines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      if (capturing) lines.push(line);
      continue;
    }
    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (/^components:|^webhooks:|^tags:|^servers:/.test(line) && inPaths) {
      inPaths = false;
      if (capturing) break;
      continue;
    }
    if (!inPaths) continue;
    const pathMatch = /^ {2}(\/\S*):/.exec(line);
    if (pathMatch) {
      if (capturing) break; // next path — op ended
      currentPath = pathMatch[1];
      continue;
    }
    if (currentPath === null) continue;
    const methodMatch = /^ {4}(get|post|put|patch|delete|options|head):/.exec(line);
    if (methodMatch) {
      if (capturing) break; // sibling method — op ended
      capturing = currentPath === opPath && methodMatch[1] === method;
      if (capturing) lines.push(line);
      continue;
    }
    if (capturing) lines.push(line);
  }
  if (lines.length === 0) {
    throw new Error(
      `${specPath}: operation ${method.toUpperCase()} ${opPath} not found — the scanner ` +
        "(or the spec) drifted; update openapi-spec-truth-r187.test.ts.",
    );
  }
  return lines;
}

/** The quoted status keys documented on an op (8-space `"NNN":`). */
function responseKeys(opPath: string, method: string): string[] {
  return opBlock(opPath, method)
    .map((l) => /^ {8}"(\d{3})":\s*$/.exec(l)?.[1])
    .filter((v): v is string => v !== undefined);
}

/** Header parameter names declared on an op (8-space `- name:` + 10-space `in: header`). */
function headerParams(opPath: string, method: string): string[] {
  const lines = opBlock(opPath, method);
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {8}- name: ([A-Za-z0-9-]+)\s*$/.exec(lines[i] as string);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j]?.trim() === "" || lines[j]?.trimStart().startsWith("#"))) {
      j++;
    }
    if (/^ {10}in: header\s*$/.test(lines[j] ?? "")) names.push(m[1] as string);
  }
  return names;
}

/** The operation-level `description: |` block, joined ("" when absent). */
function opDescription(opPath: string, method: string): string {
  const lines = opBlock(opPath, method);
  const start = lines.findIndex((l) => /^ {6}description: \|/.test(l));
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] as string;
    // Block-scalar continuation: blank or indented ≥ 8 spaces.
    if (l.trim() === "" || /^ {8}\S/.test(l)) {
      body.push(l.trim());
      continue;
    }
    break; // next op-level key (parameters:, requestBody:, responses:)
  }
  return body.join(" ");
}

/** A single response's `description: |` body ("" when absent). */
function responseDescription(opPath: string, method: string, status: string): string {
  const lines = opBlock(opPath, method);
  const anchor = `        "${status}":`;
  const start = lines.findIndex((l) => l.startsWith(anchor));
  if (start === -1) return "";
  // The description key sits 10-space under the status key; its block
  // scalar body at 12-space. Headers/content/schema siblings end it.
  const descIdx = lines.findIndex((l, i) => i > start && /^ {10}description: \|/.test(l as string));
  if (descIdx === -1 || descIdx > start + 3) return "";
  const body: string[] = [];
  for (let i = descIdx + 1; i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trim() === "" || /^ {12}\S/.test(l)) {
      body.push(l.trim());
      continue;
    }
    break; // next 10-space key (headers:, content:) or 8-space response
  }
  return body.join(" ");
}

/** The components-section block of one named schema ("" when absent). */
function schemaBlock(name: string): string {
  const anchor = `    ${name}:`;
  const start = specLines.findIndex((l) => l === anchor);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < specLines.length; i++) {
    const l = specLines[i] as string;
    // Anything indented ≥ 6 spaces (or blank/comment) belongs to the
    // schema; the next 4-space schema key ends it.
    if (l.trim() === "" || l.trimStart().startsWith("#") || /^ {6}/.test(l)) {
      body.push(l);
      continue;
    }
    break; // next 4-space schema key
  }
  return body.join("\n");
}

/** Sanity: the scanner still sees the file's real shape (vacuous-pass guard). */
const documentedPaths = specLines.filter((l) => /^ {2}(\/\S*):/.test(l)).length;
if (documentedPaths < 90) {
  throw new Error(
    `${specPath}: line scan found only ${documentedPaths} paths — expected ≥90. The ` +
      "file's indentation conventions likely changed; update the scan in " +
      "openapi-spec-truth-r187.test.ts.",
  );
}

// ── Pins ─────────────────────────────────────────────────────────────────────

describe("R187-3 spec truth — status arms the implementations actually emit", () => {
  it("POST /orders documents the 503 INVENTORY_CORRUPT arm (I-F4)", () => {
    expect(responseKeys("/orders", "post")).toContain("503");
    const desc = responseDescription("/orders", "post", "503");
    expect(desc).toContain("INVENTORY_CORRUPT");
    // The money-truth line: nothing was charged (retryable, not a loss).
    expect(desc).toContain("NOTHING was charged");
  });

  it("POST /wallet/topups documents the idempotency contract: 200 replay + 409s + Idempotency-Key (F-F2)", () => {
    const keys = responseKeys("/wallet/topups", "post");
    expect(keys).toContain("200");
    expect(keys).toContain("409");
    expect(keys).toContain("429"); // the pre-existing pending-limit arm stays
    expect(headerParams("/wallet/topups", "post")).toContain("Idempotency-Key");
    expect(responseDescription("/wallet/topups", "post", "200")).toContain("Idempotent-Replayed");
    // The three service-emitted 409 classes are named.
    const conflict = responseDescription("/wallet/topups", "post", "409");
    expect(conflict).toContain("IDEMPOTENCY_KEY_REUSE");
    expect(conflict).toContain("IN_FLIGHT_CONFLICT");
    expect(conflict).toContain("DUPLICATE_PENDING_REFERENCE");
  });

  it("POST /auth/whatsapp/verify documents the 429 exhausted arm (I-F3)", () => {
    expect(responseKeys("/auth/whatsapp/verify", "post")).toContain("429");
    expect(responseDescription("/auth/whatsapp/verify", "post", "429")).toContain("exhausted");
  });

  it("GET /loyalty no longer documents the dead 404 — the 401 covers ACCOUNT_NOT_FOUND (I-F5)", () => {
    const keys = responseKeys("/loyalty", "get");
    expect(keys).not.toContain("404");
    expect(keys).toContain("401");
    expect(responseDescription("/loyalty", "get", "401")).toContain("ACCOUNT_NOT_FOUND");
  });

  it("POST /auth/whatsapp/start: 503 reasons are the four real ones; 500/502 documented (I-F2)", () => {
    const keys = responseKeys("/auth/whatsapp/start", "post");
    expect(keys).toEqual(expect.arrayContaining(["500", "502", "503"]));
    const enumLine = opBlock("/auth/whatsapp/start", "post").find((l) =>
      l.includes(
        "enum: [gateway_disabled, whatsapp_not_paired, whatsapp_settling, gateway_waking]",
      ),
    );
    expect(
      enumLine,
      "the 503 details.reason enum must carry the four real 503 reasons",
    ).toBeTruthy();
    // store_failed is NOT a 503 reason — it answers 500 now.
    expect(responseDescription("/auth/whatsapp/start", "post", "503")).not.toContain(
      "store_failed",
    );
    expect(responseDescription("/auth/whatsapp/start", "post", "500")).toContain("store_failed");
    expect(responseDescription("/auth/whatsapp/start", "post", "502")).toContain("delivery_failed");
  });
});

describe("R187-3 spec truth — enums, params and shapes", () => {
  it("whatsapp_status is the real OpenWA lifecycle domain — no fabricated 'unavailable' (I-F1)", () => {
    const enumLine = specLines.find((l) => /^ {20}enum: \[created, initializing, qr_ready/.test(l));
    expect(enumLine, "the whatsapp_status enum must stay the emitted domain").toBeTruthy();
    expect(enumLine).toContain("failed");
    expect(enumLine).toContain("settling");
    expect(enumLine).not.toContain("unavailable");
  });

  it("GET /notifications documents the opt-in page/limit params + the paged envelope (F-F3)", () => {
    const lines = opBlock("/notifications", "get");
    const queryParams = lines
      .map((l) => /^ {8}- name: ([a-z]+)\s*$/.exec(l)?.[1])
      .filter((v): v is string => v !== undefined);
    expect(queryParams).toEqual(expect.arrayContaining(["page", "limit"]));
    expect(lines.some((l) => l.includes('$ref: "#/components/schemas/NotificationsPage"'))).toBe(
      true,
    );
    // The legacy bell array branch stays documented beside the envelope.
    expect(lines.some((l) => l.includes('$ref: "#/components/schemas/NotificationItem"'))).toBe(
      true,
    );
    // The envelope schema itself exists with the honest-total shape.
    const envelope = schemaBlock("NotificationsPage");
    expect(envelope).toContain("hasMore");
    expect(envelope).toContain("total");
  });

  it("POST /loyalty/convert-points carries the Idempotency-Key header + the 409 oneOf (F-F2)", () => {
    expect(headerParams("/loyalty/convert-points", "post")).toContain("Idempotency-Key");
    const lines = opBlock("/loyalty/convert-points", "post");
    const idx409 = lines.findIndex((l) => l.startsWith('        "409":'));
    expect(idx409).toBeGreaterThan(-1);
    const idemRef = lines.findIndex((l) =>
      l.includes('- $ref: "#/components/schemas/IdempotencyConflictResponse"'),
    );
    expect(idemRef, "the 409 must carry the IdempotencyConflictResponse oneOf arm").toBeGreaterThan(
      idx409,
    );
  });

  it("CreateSupportTicketBody.message carries the 4000-char cap (I-F6)", () => {
    const body = schemaBlock("CreateSupportTicketBody");
    expect(body).toContain("maxLength: 4000");
    expect(body).not.toContain("silently falls back");
  });
});

describe("R187-3 spec truth — description truth", () => {
  it("the /admin/users/{id} PATCH description tells the R115 story (F-F4)", () => {
    const desc = opDescription("/admin/users/{id}", "patch");
    expect(desc).not.toContain("legacy direct-update");
    expect(desc).not.toContain("no ledger");
    expect(desc).toContain("points_ledger");
    expect(desc).toContain("REJECTED");
  });

  it("the orders + topups 423 entries describe BOTH block flavors (I-F8)", () => {
    for (const p of ["/orders", "/wallet/topups"]) {
      const desc = responseDescription(p, "post", "423");
      expect(desc, `${p} 423 must name the soft-block flavor`).toContain("soft_block");
      expect(desc, `${p} 423 must name the hard-block flavor`).toContain("hard_block");
    }
  });

  it("AdminAlert.type lists the full backend AlertType union (E-F2)", () => {
    const block = schemaBlock("AdminAlert");
    for (const t of [
      "inventory_corrupt",
      "coupon_expired",
      "flash_sale_expired",
      "refunded_live_credentials",
      "whatsapp_channel",
    ]) {
      expect(block, `AdminAlert.type description must list ${t}`).toContain(t);
    }
  });
});
