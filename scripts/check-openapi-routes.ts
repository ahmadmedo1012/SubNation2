#!/usr/bin/env -S npx tsx
/**
 * OpenAPI ↔ Express route contract gate (round-92 B3 recommendation 5).
 *
 * Background: the round-92 B3 API-contract audit found 159 implemented
 * /api operations but only 60 documented ones — including a money-moving
 * route (PATCH /api/admin/users/{id}) that landed WITHOUT a spec entry
 * after the round-4 money-family documentation pass. This script is the
 * CI tripwire so that gap can never silently grow again.
 *
 * Responsibilities:
 *   1. Enumerate the DOCUMENTED surface: parse shared/api-spec/openapi.yaml
 *      paths + methods (line-based scan — no YAML dependency; the file's
 *      uniform 2/4-space indentation makes this reliable, and a sanity
 *      check fails loudly if the format drifts).
 *   2. Enumerate the IMPLEMENTED surface: statically parse the Express
 *      route tree (backend/src/app.ts mount points → routes/index.ts →
 *      every router file under backend/src/routes/**). Resolves
 *      `router.use(prefix, ...middlewares, childRouter)` mounts and
 *      `receiver.METHOD("/path", ...)` leaf registrations, including
 *      multi-line calls and aliased imports (copilot/index.ts pattern).
 *   3. Diff both directions:
 *        - documented-but-not-implemented → always a FAILURE (stale docs);
 *        - implemented-but-not-documented → FAILURE unless the op is in
 *          the KNOWN_UNDOCUMENTED allowlist below (internal/diagnostics/
 *          observability + the pre-existing known-gap families from the
 *          B3 audit, pending the F-09/F-10 scope-policy decisions).
 *   4. Exit 0 (contract in sync) or exit 1 with a diff table and a
 *      remediation hint.
 *
 * Usage:
 *     npx tsx scripts/check-openapi-routes.ts          # from repo root
 *     pnpm --filter @workspace/scripts run check:openapi
 *
 * When you add a NEW Express route you have two options:
 *   a. document it in shared/api-spec/openapi.yaml (+ `pnpm codegen`), or
 *   b. consciously add it to KNOWN_UNDOCUMENTED with a category + reason
 *      (only acceptable for internal/diagnostics surface).
 * Never delete entries from KNOWN_UNDOCUMENTED without documenting them.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Configuration ────────────────────────────────────────────────────────────

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "shared", "api-spec", "openapi.yaml");
const routesDir = path.join(repoRoot, "backend", "src", "routes");
const appTsPath = path.join(repoRoot, "backend", "src", "app.ts");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface Op {
  method: string; // uppercase for display, lowercase for matching
  path: string; // normalized template form: /admin/users/{id}
}

/**
 * Implemented-but-undocumented operations that are ALLOWED to stay out of
 * the spec of record. Seeded from the round-92 B3 audit (Table B) — every
 * entry predates the gate. Categories:
 *
 *   internal    — health probes / metrics / CWV / SEO — deliberately
 *                 machine-facing, will likely never enter the spec.
 *   auth-gap    — the passwordless credential-issuing surface (B3 F-09);
 *                 documented in docs/API.md prose only, pending a scope
 *                 decision on the auth family.
 *   admin-gap   — internal admin families (B3 F-10): risk, forecast,
 *                 enrichment, tickets, alerts, security, observability,
 *                 diagnostics, admins lifecycle, settings, 2FA, pricing,
 *                 chart-data, referrals read, copilot settings, inventory
 *                 writes. Pending the F-10 scope-policy decision.
 *   alias       — canonical twins of documented alias paths
 *                 (/products/stats ↔ /catalog/stats, B3 F-15).
 */
const KNOWN_UNDOCUMENTED: ReadonlyArray<{ method: string; path: string; category: string }> = [
  // internal — machine-facing liveness/metrics/telemetry (B3 B.3)
  { method: "get", path: "/api/healthz/live", category: "internal" },
  { method: "get", path: "/api/healthz/summary", category: "internal" },
  { method: "get", path: "/api/healthz/ready", category: "internal" },
  { method: "get", path: "/api/healthz/redis", category: "internal" },
  { method: "get", path: "/api/healthz/neon", category: "internal" },
  { method: "get", path: "/api/healthz/worker", category: "internal" },
  { method: "get", path: "/api/healthz/socket", category: "internal" },
  { method: "get", path: "/api/healthz/firebase", category: "internal" },
  { method: "get", path: "/api/metrics", category: "internal" },
  { method: "post", path: "/api/cwv", category: "internal" },
  { method: "get", path: "/robots.txt", category: "internal" },
  { method: "get", path: "/sitemap.xml", category: "internal" },
  // internal — 200-always session probes (auth.ts:347, admin/auth.ts:188)
  // (98-F9: /api/auth/probe moved OUT of this list — it is now fully
  // documented in openapi.yaml together with the rest of the auth mint
  // family: whatsapp/start+verify, providers, telegram ×3, firebase
  // session+refresh. Removed per the "remove from KNOWN_UNDOCUMENTED"
  // rule once documented.)
  { method: "get", path: "/api/admin/probe", category: "internal" },

  // alias — canonical twins of documented alias routes (B3 F-15)
  { method: "get", path: "/api/products/stats", category: "alias" },
  { method: "get", path: "/api/products/flash-sale", category: "alias" },

  // auth-gap — credential-issuing surface, docs/API.md prose only (B3 F-09)
  // (98-F9: the nine primary mint/provider paths below — firebase/session,
  // firebase/refresh, telegram, telegram/webapp, telegram/callback,
  // whatsapp/start, whatsapp/verify, providers, probe — were DOCUMENTED in
  // openapi.yaml this round (the highest-leverage contract gap: WhatsApp is
  // the primary Libyan sign-in) and therefore removed from this list. The
  // remaining entries are secondary session-management surface.)
  { method: "post", path: "/api/auth/logout-all-devices", category: "auth-gap" },
  { method: "get", path: "/api/auth/providers/linked", category: "auth-gap" },
  { method: "post", path: "/api/auth/providers/unlink", category: "auth-gap" },
  { method: "post", path: "/api/auth/onboarding/complete", category: "auth-gap" },
  { method: "delete", path: "/api/auth/sessions/{id}", category: "auth-gap" },

  // admin-gap — admin auth/2FA/session lifecycle (B3 B.1)
  { method: "post", path: "/api/admin/login/verify-2fa", category: "admin-gap" },
  { method: "get", path: "/api/admin/session", category: "admin-gap" },
  { method: "post", path: "/api/admin/logout", category: "admin-gap" },
  { method: "post", path: "/api/admin/change-password", category: "admin-gap" },
  { method: "post", path: "/api/admin/2fa/setup", category: "admin-gap" },
  { method: "post", path: "/api/admin/2fa/verify-setup", category: "admin-gap" },
  { method: "patch", path: "/api/admin/profile", category: "admin-gap" },

  // admin-gap — admin account lifecycle (B3 B.1: 6 ops)
  { method: "get", path: "/api/admin/admins", category: "admin-gap" },
  { method: "post", path: "/api/admin/admins", category: "admin-gap" },
  { method: "patch", path: "/api/admin/admins/{id}", category: "admin-gap" },
  { method: "post", path: "/api/admin/admins/{id}/disable", category: "admin-gap" },
  { method: "post", path: "/api/admin/admins/{id}/enable", category: "admin-gap" },
  { method: "get", path: "/api/admin/admins/scopes", category: "admin-gap" },

  // admin-gap — auth-provider settings toggles (B3 B.1)
  { method: "get", path: "/api/admin/settings", category: "admin-gap" },
  { method: "get", path: "/api/admin/settings/auth", category: "admin-gap" },
  { method: "patch", path: "/api/admin/settings/auth/{id}", category: "admin-gap" },

  // admin-gap — pricing margin calculator (B3 B.1)
  { method: "post", path: "/api/admin/pricing/calculate", category: "admin-gap" },

  // admin-gap — risk/anomaly detection family (B3 B.2: 10 ops)
  { method: "get", path: "/api/admin/risk/events", category: "admin-gap" },
  { method: "get", path: "/api/admin/risk/events/{id}", category: "admin-gap" },
  { method: "post", path: "/api/admin/risk/events/{id}/label", category: "admin-gap" },
  { method: "post", path: "/api/admin/risk/events/bulk-label", category: "admin-gap" },
  { method: "get", path: "/api/admin/risk/rules", category: "admin-gap" },
  { method: "put", path: "/api/admin/risk/rules/{id}", category: "admin-gap" },
  { method: "get", path: "/api/admin/risk/config", category: "admin-gap" },
  { method: "put", path: "/api/admin/risk/config", category: "admin-gap" },
  { method: "get", path: "/api/admin/risk/dashboard", category: "admin-gap" },
  { method: "post", path: "/api/admin/risk/synth", category: "admin-gap" },

  // admin-gap — forecast family (B3 B.2: 2 ops)
  { method: "get", path: "/api/admin/forecast/at-risk", category: "admin-gap" },
  { method: "get", path: "/api/admin/forecast/products/{id}", category: "admin-gap" },

  // admin-gap — enrichment review family (B3 B.2: 3 ops)
  { method: "get", path: "/api/admin/enrichment/list", category: "admin-gap" },
  { method: "post", path: "/api/admin/enrichment/{id}/publish", category: "admin-gap" },
  { method: "post", path: "/api/admin/enrichment/{id}/reject", category: "admin-gap" },

  // admin-gap — admin tickets family (B3 B.2: 4 ops)
  { method: "get", path: "/api/admin/tickets", category: "admin-gap" },
  { method: "get", path: "/api/admin/tickets/{id}", category: "admin-gap" },
  { method: "post", path: "/api/admin/tickets/{id}/reply", category: "admin-gap" },
  { method: "patch", path: "/api/admin/tickets/{id}/status", category: "admin-gap" },

  // admin-gap — admin alerts family (B3 B.2: 9 ops)
  { method: "post", path: "/api/admin/alerts/test", category: "admin-gap" },
  { method: "get", path: "/api/admin/alerts", category: "admin-gap" },
  { method: "get", path: "/api/admin/alerts/new", category: "admin-gap" },
  { method: "get", path: "/api/admin/alerts/unread-count", category: "admin-gap" },
  { method: "patch", path: "/api/admin/alerts/read-all", category: "admin-gap" },
  { method: "patch", path: "/api/admin/alerts/{id}/read", category: "admin-gap" },
  { method: "delete", path: "/api/admin/alerts", category: "admin-gap" },
  { method: "delete", path: "/api/admin/alerts/read", category: "admin-gap" },
  { method: "delete", path: "/api/admin/alerts/{id}", category: "admin-gap" },

  // admin-gap — security audit family (B3 B.2: 3 ops)
  { method: "get", path: "/api/admin/auth-activity", category: "admin-gap" },
  { method: "get", path: "/api/admin/auth-stats", category: "admin-gap" },
  { method: "get", path: "/api/admin/auth-stats/summary", category: "admin-gap" },

  // admin-gap — observability family (B3 B.2: 6 ops)
  { method: "get", path: "/api/admin/observability/summary", category: "admin-gap" },
  { method: "get", path: "/api/admin/observability/alerts/recent", category: "admin-gap" },
  { method: "get", path: "/api/admin/observability/deploys/recent", category: "admin-gap" },
  { method: "get", path: "/api/admin/observability/sentry/summary", category: "admin-gap" },
  { method: "get", path: "/api/admin/observability/metrics", category: "admin-gap" },
  { method: "get", path: "/api/admin/observability/scheduler", category: "admin-gap" },

  // admin-gap — diagnostics family (B3 B.2: 9 ops)
  { method: "get", path: "/api/admin/diagnostics", category: "admin-gap" },
  { method: "get", path: "/api/admin/diagnostics/sentry-debug", category: "admin-gap" },
  { method: "get", path: "/api/admin/diagnostics/whatsapp/sessions", category: "admin-gap" },
  { method: "post", path: "/api/admin/diagnostics/whatsapp/sessions", category: "admin-gap" },
  {
    method: "post",
    path: "/api/admin/diagnostics/whatsapp/sessions/{id}/start",
    category: "admin-gap",
  },
  {
    method: "post",
    path: "/api/admin/diagnostics/whatsapp/sessions/{id}/pair-code",
    category: "admin-gap",
  },
  {
    method: "get",
    path: "/api/admin/diagnostics/whatsapp/sessions/{id}/qr",
    category: "admin-gap",
  },
  {
    method: "delete",
    path: "/api/admin/diagnostics/whatsapp/sessions/{id}",
    category: "admin-gap",
  },
  { method: "post", path: "/api/admin/diagnostics/telegram-test", category: "admin-gap" },

  // admin-gap — inventory admin writes (B3 B.2: 3 ops)
  { method: "get", path: "/api/admin/products/{id}/inventory", category: "admin-gap" },
  { method: "post", path: "/api/admin/products/{id}/inventory", category: "admin-gap" },
  { method: "post", path: "/api/admin/products/{id}/inventory/set-count", category: "admin-gap" },

  // admin-gap — misc reads (B3 B.2)
  { method: "get", path: "/api/admin/referrals", category: "admin-gap" },
  { method: "get", path: "/api/admin/chart-data", category: "admin-gap" },
  { method: "get", path: "/api/admin/copilot/settings", category: "admin-gap" },
  { method: "patch", path: "/api/admin/copilot/settings", category: "admin-gap" },
];

// ── OpenAPI side: line-based path/method scan ───────────────────────────────

function parseOpenApiOps(): Map<string, Op> {
  const src = readFileSync(openApiPath, "utf8");
  const lines = src.split("\n");
  const ops = new Map<string, Op>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const rawLine of lines) {
    // Blank/comment-only lines carry no structure for this scan.
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;

    if (/^paths:/.test(rawLine)) {
      inPaths = true;
      continue;
    }
    if (/^components:|^webhooks:|^tags:|^servers:/.test(rawLine) && inPaths) {
      inPaths = false; // paths: block ended
      continue;
    }
    if (!inPaths) continue;

    const pathMatch = /^ {2}(\/\S*):/.exec(rawLine);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    if (currentPath === null) continue;

    const methodMatch = new RegExp(`^ {4}(${HTTP_METHODS.join("|")}):`).exec(rawLine);
    if (methodMatch) {
      const method = methodMatch[1] as HttpMethod;
      const key = `${method} ${currentPath}`;
      if (ops.has(key)) {
        throw new Error(`openapi.yaml: duplicate operation ${key}`);
      }
      ops.set(key, { method, path: currentPath });
    }
  }

  // Sanity checks — fail loudly if the file's format stops matching the
  // assumptions of this scanner instead of silently reporting zero ops.
  if (ops.size < 40) {
    throw new Error(
      `openapi.yaml scan found only ${ops.size} operations — expected ≥40. ` +
        "The file's indentation conventions likely changed; update parseOpenApiOps().",
    );
  }
  if (!ops.has("get /healthz")) {
    throw new Error("openapi.yaml scan did not find GET /healthz — scanner is broken.");
  }
  return ops;
}

// ── Express side: static route-tree resolution ──────────────────────────────

interface LeafCall {
  receiver: string;
  method: string;
  path: string;
}

interface RouteFileInfo {
  src: string;
  imports: Map<string, { file: string; imported: string }>; // localName → {source file, exported name}
  routerDefs: Set<string>; // local vars assigned Router()
  exportMap: Map<string, string>; // exported name (or "default") → local router var
  leafCalls: LeafCall[];
}

/** Recursively collect .ts files under a directory. */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Split a call's argument string on top-level commas. The input is the raw
 * source between the call's opening and closing parens; nested calls like
 * requirePermission("finance") and object literals keep depth > 0 and are
 * preserved intact.
 */
function splitTopLevelArgs(argSrc: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let inString: string | null = null;
  // 98-F9: line comments between args (the admin/index.ts multi-router
  // mounts annotate EVERY router — `adminProductsRouter, // /products/*`)
  // used to glue onto the NEXT argument, so `adminProductVariantsRouter`
  // failed the bare-identifier match downstream and its routes silently
  // vanished from the implemented set (the pre-existing "documented but
  // NOT implemented" false positives). Strip comments BEFORE splitting.
  let sanitized = "";
  for (let i = 0; i < argSrc.length; i++) {
    const ch = argSrc[i];
    if (inString) {
      sanitized += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      sanitized += ch;
      continue;
    }
    if (ch === "/" && argSrc[i + 1] === "/") {
      // skip until end-of-line
      while (i < argSrc.length && argSrc[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && argSrc[i + 1] === "*") {
      i += 2;
      while (i < argSrc.length && !(argSrc[i] === "*" && argSrc[i + 1] === "/")) i++;
      i++; // past the closing /
      continue;
    }
    sanitized += ch;
  }
  argSrc = sanitized;
  inString = null;
  for (const ch of argSrc) {
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

/** Extract the full argument source of `receiver.methodName(...)`, honoring nesting. */
function extractCallArgSource(
  src: string,
  receiver: string,
  methodName: string,
): Array<{ argSrc: string }> {
  const results: Array<{ argSrc: string }> = [];
  const callRe = new RegExp(`\\b${receiver}\\.${methodName}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // index of "("
    let depth = 0;
    let inString: string | null = null;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (ch === "\\") {
          i++; // skip escaped char
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue; // malformed / truncated — skip
    results.push({ argSrc: src.slice(open + 1, end) });
    callRe.lastIndex = end + 1;
  }
  return results;
}

/** Resolve a relative import specifier (no .ts extension in this repo) to a file. */
function resolveImportFile(fromFile: string, source: string): string | null {
  const base = path.resolve(path.dirname(fromFile), source);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function parseRouteFile(file: string): RouteFileInfo {
  const src = readFileSync(file, "utf8");
  // Imports: `import X from "..."`, `import { A, B as C } from "..."`,
  // `import type ...` (skipped — types can't be routers).
  const imports = new Map<string, { file: string; imported: string }>();
  const importRe =
    /^import\s+(type\s+)?([A-Za-z_$][\w$]*)?\s*(?:,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(src)) !== null) {
    const isType = !!im[1];
    if (isType) continue;
    const source = im[4];
    if (!source.startsWith(".")) continue; // external package — not a router file
    const resolved = resolveImportFile(file, source);
    if (!resolved) continue;
    const defaultImport = im[2];
    if (defaultImport) {
      imports.set(defaultImport, { file: resolved, imported: "default" });
    }
    for (const part of im[3].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      const importedName = asMatch ? asMatch[1] : trimmed.replace(/^type\s+/, "");
      const localName = asMatch ? asMatch[2] : importedName;
      if (!importedName || !localName) continue;
      imports.set(localName, { file: resolved, imported: importedName });
    }
  }
  // Bare default import without braces: `import X from "./file"` (already
  // covered above), plus `import router from "./routes"` variants that
  // don't match the braces regex.
  const defaultImportRe = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["'](\.[^"']+)["']/gm;
  while ((im = defaultImportRe.exec(src)) !== null) {
    if (!imports.has(im[1])) {
      const resolved = resolveImportFile(file, im[2]);
      if (!resolved) continue;
      imports.set(im[1], { file: resolved, imported: "default" });
    }
  }

  // Router definitions: const/let/var X[: Type] = Router(...) — captures
  // `const router = Router()`, `const router: IRouter = Router()` (the
  // health/flash-sales/observability/diagnostics/seo pattern), and
  // `export const copilotRouter = Router()`.
  const routerDefs = new Set<string>();
  const routerDefRe =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$.<>[\]]*\s*)?=\s*Router\s*\(/g;
  let rd: RegExpExecArray | null;
  while ((rd = routerDefRe.exec(src)) !== null) routerDefs.add(rd[1]);

  // Export map: "default" + named exports that point at router vars.
  const exportMap = new Map<string, string>();
  const defaultExportRe = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m;
  const de = defaultExportRe.exec(src);
  if (de && routerDefs.has(de[1])) exportMap.set("default", de[1]);
  // export { router as X } / export { X }
  const exportListRe = /^export\s*\{([^}]*)\}/gm;
  let el: RegExpExecArray | null;
  while ((el = exportListRe.exec(src)) !== null) {
    for (const part of el[1].split(",")) {
      const trimmed = part.trim().replace(/^type\s+/, "");
      if (!trimmed) continue;
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      const local = asMatch ? asMatch[1] : trimmed;
      const exported = asMatch ? asMatch[2] : trimmed;
      if (routerDefs.has(local)) exportMap.set(exported, local);
    }
  }
  // export const X = router;   (risk/forecast/enrichment pattern)
  const exportConstRe = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
  let ec: RegExpExecArray | null;
  while ((ec = exportConstRe.exec(src)) !== null) {
    if (routerDefs.has(ec[2])) exportMap.set(ec[1], ec[2]);
  }
  // export const X = Router() — X is both the def and the export.
  for (const def of routerDefs) exportMap.set(def, def);

  // Leaf registrations: X.METHOD("/path", ...) — first arg must be a
  // string literal; regex tolerates newlines after the paren (ask.ts
  // registers multi-line).
  const leafCalls: LeafCall[] = [];
  const methodAlternation = HTTP_METHODS.join("|");
  const leafRe = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\.(${methodAlternation})\\(\\s*(["'\`])([^"'\`]+)\\3`,
    "g",
  );
  let lf: RegExpExecArray | null;
  while ((lf = leafRe.exec(src)) !== null) {
    leafCalls.push({ receiver: lf[1], method: lf[2], path: lf[4] });
  }

  return { src, imports, routerDefs, exportMap, leafCalls };
}

/**
 * Resolve the full route tree from app.ts down. `receiver → calls` are
 * grouped per receiver variable so files defining several routers
 * (auth-settings.ts) stay correct.
 */
function resolveImplementedOps(): Map<string, Op> {
  const files = new Map<string, RouteFileInfo>();
  for (const file of listTsFiles(routesDir)) {
    files.set(path.resolve(file), parseRouteFile(file));
  }
  const appInfo = parseRouteFile(appTsPath);
  files.set(path.resolve(appTsPath), appInfo);

  const ops = new Map<string, Op>();
  const visited = new Set<string>();

  function record(method: string, fullPath: string) {
    const normalized = normalizeExpressPath(fullPath);
    const key = `${method} ${normalized}`;
    if (!ops.has(key)) ops.set(key, { method, path: normalized });
  }

  function resolveRouter(file: string, routerVar: string, prefix: string) {
    const guard = `${file}::${routerVar}::${prefix}`;
    if (visited.has(guard)) return;
    visited.add(guard);

    const info = files.get(file);
    if (!info) return;

    // Leaf registrations on this router var.
    for (const leaf of info.leafCalls) {
      if (leaf.receiver !== routerVar) continue;
      record(leaf.method, joinPaths(prefix, leaf.path));
    }

    // Mounts from this router var.
    for (const { argSrc } of extractCallArgSource(info.src, routerVar, "use")) {
      const args = splitTopLevelArgs(argSrc);
      const stringArg = args.find((a) => /^["']([^"']*)["']$/.test(a));
      const subPrefix = stringArg ? stringArg.slice(1, -1) : "";
      const identifiers = args.filter((a) => /^[A-Za-z_$][\w$]*$/.test(a));
      for (const ident of identifiers) {
        const nextPrefix = joinPaths(prefix, subPrefix);
        // (a) router defined in the same file (admin/index.ts protectedRouter)
        if (info.routerDefs.has(ident) && ident !== routerVar) {
          resolveRouter(file, ident, nextPrefix);
          continue;
        }
        // (b) imported router from another file
        const imp = info.imports.get(ident);
        if (!imp) continue;
        const targetInfo = files.get(imp.file);
        if (!targetInfo) continue;
        const targetLocal = targetInfo.exportMap.get(imp.imported);
        if (!targetLocal) continue; // imported symbol is not a router (middleware etc.)
        resolveRouter(imp.file, targetLocal, nextPrefix);
      }
    }
  }

  // Entry points from app.ts: app.use("/api", router) + app.use(seoRouter).
  for (const { argSrc } of extractCallArgSource(appInfo.src, "app", "use")) {
    const args = splitTopLevelArgs(argSrc);
    const stringArg = args.find((a) => /^["']([^"']*)["']$/.test(a));
    const prefix = stringArg ? stringArg.slice(1, -1) : "";
    const identifiers = args.filter((a) => /^[A-Za-z_$][\w$]*$/.test(a));
    for (const ident of identifiers) {
      const imp = appInfo.imports.get(ident);
      if (!imp) continue;
      const targetInfo = files.get(imp.file);
      if (!targetInfo) continue;
      const targetLocal = targetInfo.exportMap.get(imp.imported);
      if (!targetLocal) continue;
      resolveRouter(imp.file, targetLocal, prefix);
    }
  }

  return ops;
}

function joinPaths(prefix: string, suffix: string): string {
  if (!suffix || suffix === "/") return prefix || "/";
  if (!prefix) return suffix.startsWith("/") ? suffix : `/${suffix}`;
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const right = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${left}${right}`;
}

/** Express path → OpenAPI template form: /users/:id → /users/{id} */
function normalizeExpressPath(p: string): string {
  const templated = p.replace(/:([A-Za-z_][\w]*)/g, "{$1}");
  return templated.length > 1 && templated.endsWith("/") ? templated.slice(0, -1) : templated;
}

// ── Diff + report ───────────────────────────────────────────────────────────

function main(): void {
  const documented = parseOpenApiOps();
  const implemented = resolveImplementedOps();

  // Keys are normalized "method /full/path" strings (lowercase method,
  // {param} template form). Documented openapi.yaml paths are relative to
  // the `/api` server base (openapi.yaml servers.url) — rebase them onto
  // the full request path so both sides compare in the same space.
  const documentedKeys = new Set(
    [...documented.keys()].map((k) => {
      const [method, p] = k.split(" ");
      return `${method} /api${p}`;
    }),
  );
  const implementedKeys = new Set(implemented.keys());
  const allowlistKeys = new Set(
    KNOWN_UNDOCUMENTED.map((e) => `${e.method.toLowerCase()} ${e.path}`),
  );

  const staleDocs = [...documentedKeys].filter((k) => !implementedKeys.has(k)).sort();
  const undocumented = [...implementedKeys]
    .filter((k) => !documentedKeys.has(k) && !allowlistKeys.has(k))
    .sort();
  const allowlistedButGone = [...allowlistKeys].filter((k) => !implementedKeys.has(k)).sort();
  const documentedButAllowlisted = [...allowlistKeys].filter((k) => documentedKeys.has(k));

  if (process.env.DEBUG_ROUTES) {
    console.log("DEBUG: implemented keys:");
    for (const k of [...implementedKeys].sort()) console.log(`  ${k}`);
    console.log("");
  }

  console.log("OpenAPI ↔ Express route contract gate");
  console.log(`  Documented operations (openapi.yaml): ${documentedKeys.size}`);
  console.log(`  Implemented operations (Express):     ${implementedKeys.size}`);
  console.log(
    `  Allowlisted known gaps:               ${
      [...allowlistKeys].filter((k) => implementedKeys.has(k)).length
    } (internal/diagnostics/known-gap families)`,
  );
  console.log(
    `  Contract coverage (implemented & documented): ${
      [...implementedKeys].filter((k) => documentedKeys.has(k)).length
    }/${implementedKeys.size}`,
  );
  console.log("");

  if (staleDocs.length > 0) {
    console.log("❌ Documented but NOT implemented (stale docs):");
    for (const k of staleDocs) console.log(`     ${k}`);
    console.log("   → Remove or update these operations in shared/api-spec/openapi.yaml");
    console.log("");
  }

  if (undocumented.length > 0) {
    console.log("❌ Implemented but NOT documented (outside the allowlist):");
    for (const k of undocumented) console.log(`     ${k}`);
    console.log("   → Document these in shared/api-spec/openapi.yaml (+ `pnpm codegen`),");
    console.log("     or — only for internal/diagnostics surface — add them to");
    console.log("     KNOWN_UNDOCUMENTED in scripts/check-openapi-routes.ts with a reason.");
    console.log("");
  }

  if (allowlistedButGone.length > 0) {
    console.log("⚠️  Allowlisted but no longer implemented (clean these up):");
    for (const k of allowlistedButGone) console.log(`     ${k}`);
    console.log("");
  }

  if (documentedButAllowlisted.length > 0) {
    console.log("⚠️  Documented AND allowlisted — remove from KNOWN_UNDOCUMENTED:");
    for (const k of documentedButAllowlisted) console.log(`     ${k}`);
    console.log("");
  }

  if (staleDocs.length === 0 && undocumented.length === 0) {
    console.log("✅ API contract in sync: every enforced route is documented,");
    console.log("   and every documented operation has a live Express handler.");
    console.log(
      `   Gate enforces ${
        [...implementedKeys].filter((k) => !allowlistKeys.has(k)).length
      } implemented operations (public + money + admin-money + copilot families).`,
    );
  } else {
    process.exitCode = 1;
  }
}

main();
