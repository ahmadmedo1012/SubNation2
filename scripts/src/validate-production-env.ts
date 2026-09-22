#!/usr/bin/env tsx
/**
 * validate-production-env — mission §44 (R108 final hardening).
 *
 * Validates a production environment file (or the live process env) against
 * the repo's own source-of-truth rules — catching the classes of misconfig
 * the boot fail-fast cannot see:
 *
 *   - placeholder values that PASS the per-var length rules (F-10: the
 *     compose template's `SESSION_SECRET=replace-with-random-64-char-secret`
 *     is 34 chars ≥ 32 → production would boot signing JWTs with a public
 *     template string);
 *   - cross-service parity (WHATSAPP_OTP_API_KEY must equal OPENWA_API_KEY);
 *   - forbidden equalities among independent secrets;
 *   - origin consistency (CORS/CSRF/Socket.IO allowlist vs canonical URL
 *     vs VITE_APP_ORIGIN);
 *   - dangerous combinations (DISABLE_WEB_SCHEDULERS with no worker,
 *     drain budget > compose kill window, demo seed into prod, …).
 *
 * MASKING IS A HARD REQUIREMENT (mission §44): this script NEVER prints a
 * secret value — only variable NAMES, lengths, boolean shape results, and
 * equality/inequality between two named vars. URL checks report scheme +
 * "host present" + sslmode presence only. A check that cannot be expressed
 * without leaking a value gets dropped, not adapted.
 *
 * Usage:
 *   tsx scripts/src/validate-production-env.ts [--file .env]
 *        [--profile compose|backend] [--strict] [--json] [--boot]
 *
 * Exit codes: 0 = pass · 1 = errors found (or warnings, under --strict) ·
 * 2 = usage error. --boot runs ONLY the pure in-container subset
 * (placeholders / parity / equal-secrets / pair rules — zero file I/O) for
 * the future bootstrapCore() pre-flight import.
 *
 * Wiring (runbook Phase 3): run with --strict on the filled .env BEFORE
 * any deploy minutes or VM time is spent:
 *   tsx scripts/src/validate-production-env.ts --file .env --strict
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

type Level = "error" | "warning" | "info";

interface Finding {
  level: Level;
  name: string;
  message: string;
}

// ── Env-file parsing (identical semantics to backend/src/lib/env.ts) ────────

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

function parseEnvFile(filePath: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(filePath)) return out;
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = parseEnvValue(rawValue);
    if (value === "") continue;
    out.set(key, value);
  }
  return out;
}

/** Placeholder values from the committed templates — a filled prod env must not equal any of them. */
function loadTemplateValues(repoRoot: string): Set<string> {
  const values = new Set<string>();
  for (const rel of ["config/env.example", "deploy/env.compose.example"]) {
    const file = path.join(repoRoot, rel);
    if (!existsSync(file)) continue;
    for (const v of parseEnvFile(file).values()) values.add(v);
  }
  return values;
}

const PLACEHOLDER_RE =
  /replace-with|replace-before|changeme|change-me|REPLACE_ME|dummy|placeholder|USER:PASSWORD|your-[a-z0-9-]*-here/i;

// ── Report ──────────────────────────────────────────────────────────────────

class Report {
  readonly findings: Finding[] = [];
  checked = 0;

  add(level: Level, name: string, message: string): void {
    this.findings.push({ level, name, message });
  }

  get errors(): Finding[] {
    return this.findings.filter((f) => f.level === "error");
  }
  get warnings(): Finding[] {
    return this.findings.filter((f) => f.level === "warning");
  }
  get infos(): Finding[] {
    return this.findings.filter((f) => f.level === "info");
  }
}

// ── Helpers (all value-silent) ──────────────────────────────────────────────

function isSet(env: Map<string, string>, name: string): boolean {
  return env.has(name) && env.get(name)!.trim() !== "";
}

/** Constant-time equality on sha256 digests — no timing side-channel even here. */
function secretEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

function isHex64(v: string | undefined): boolean {
  return typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
}

/** Parse and classify a URL WITHOUT printing it. Returns silent descriptors. */
function describeUrl(raw: string | undefined): { ok: boolean; scheme: string; host: string } {
  if (!raw) return { ok: false, scheme: "", host: "" };
  try {
    const u = new URL(raw);
    return { ok: true, scheme: u.protocol.replace(":", ""), host: u.hostname };
  } catch {
    return { ok: false, scheme: "", host: "" };
  }
}

function isValidPort(raw: string | undefined): boolean | null {
  if (raw === undefined || raw.trim() === "") return null; // unset = fine
  // Accept the host:port compose form — validate the port part.
  const portPart = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  if (!/^\d+$/.test(portPart.trim())) return false;
  const n = Number(portPart.trim());
  return n >= 1 && n <= 65535;
}

// ── The pure boot subset (future bootstrapCore() pre-flight import) ────────

export interface BootSubsetInput {
  env: Readonly<Record<string, string>>;
  templateValues: ReadonlySet<string>;
}

/**
 * Zero-I/O checks suitable for in-container boot pre-flight: placeholder
 * detection, cross-service parity, forbidden equal-secrets, pair rules.
 * Returns silent finding strings (names only — never values).
 */
export function runBootSubset({ env, templateValues }: BootSubsetInput): string[] {
  const out: string[] = [];
  const get = (k: string) => (env[k] !== undefined && env[k] !== "" ? env[k] : undefined);

  // Placeholder / template-value detection on every secret-shaped var.
  for (const name of SECRET_VARS) {
    const v = get(name);
    if (v === undefined) continue;
    if (PLACEHOLDER_RE.test(v)) {
      out.push(
        `${name}: looks like a template placeholder (boot would otherwise pass it silently)`,
      );
    } else if (templateValues.has(v)) {
      out.push(`${name}: equals a value literally present in a committed env template`);
    }
  }

  // Forbidden equality among independent secrets.
  const present = SECRET_VARS.filter((n) => get(n) !== undefined);
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (secretEqual(get(present[i]), get(present[j]))) {
        out.push(`${present[i]} and ${present[j]} are EQUAL — independent secrets must differ`);
      }
    }
  }

  // Required cross-service parity: the gateway rejects everything else.
  const otp = get("WHATSAPP_OTP_API_KEY");
  const gw = get("OPENWA_API_KEY");
  if (otp !== undefined && gw !== undefined && !secretEqual(otp, gw)) {
    out.push(
      "WHATSAPP_OTP_API_KEY and OPENWA_API_KEY DIFFER — the gateway will reject every OTP call",
    );
  }

  // Dashboard pair rule.
  const du = get("DASHBOARD_USERNAME");
  const dp = get("DASHBOARD_PASSWORD");
  if ((du !== undefined && dp === undefined) || (dp !== undefined && du === undefined)) {
    out.push("DASHBOARD_USERNAME / DASHBOARD_PASSWORD: only one of the pair is set");
  }

  return out;
}

const SECRET_VARS = [
  "SESSION_SECRET",
  "ADMIN_JWT_SECRET",
  "ENCRYPTION_KEY",
  "OPENWA_CREDENTIALS_KEY",
  "OTP_HMAC_KEY",
  "DASHBOARD_SESSION_SECRET",
] as const;

// ── Full validation (file + profile aware) ─────────────────────────────────

interface CliOptions {
  file: string;
  profile: "compose" | "backend";
  strict: boolean;
  json: boolean;
  boot: boolean;
}

function usage(code: number): never {
  console.error(
    "Usage: tsx scripts/src/validate-production-env.ts [--file .env] " +
      "[--profile compose|backend] [--strict] [--json] [--boot]",
  );
  process.exit(code);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    file: ".env",
    profile: "compose",
    strict: false,
    json: false,
    boot: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") opts.file = argv[++i] ?? usage(2);
    else if (a === "--profile") {
      const v = argv[++i];
      if (v !== "compose" && v !== "backend") usage(2);
      opts.profile = v;
    } else if (a === "--strict") opts.strict = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--boot") opts.boot = true;
    else usage(2);
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const templateValues = loadTemplateValues(repoRoot);

  // --boot: the pure subset against the LIVE process env (no file I/O).
  if (opts.boot) {
    const findings = runBootSubset({
      env: process.env as Record<string, string>,
      templateValues,
    });
    for (const f of findings) console.error(`[env-boot] ${f}`);
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (!existsSync(opts.file)) {
    console.error(`[env] file not found: ${opts.file}`);
    process.exit(2);
  }
  const env = parseEnvFile(opts.file);
  const report = new Report();
  const get = (name: string) => env.get(name);

  // ── 1. Missing required ────────────────────────────────────────────────
  const required: Array<[string, string]> = [
    ["DATABASE_URL", "boot throws at pool init"],
    ["SESSION_SECRET", "jwt.ts refuses to sign sessions"],
    ["ENCRYPTION_KEY", "encryption.ts aborts production boot"],
    ["ADMIN_JWT_SECRET", "admin login is impossible in production"],
    ["APP_URL", "canonical URL / CSRF gate unset"],
    ["APP_ORIGINS", "prod CSRF allowlist empty → boot abort"],
  ];
  if (opts.profile === "compose") {
    required.push(
      ["OPENWA_API_KEY", "gateway container refuses to start (open relay guard)"],
      ["PERSISTENCE_URL", "WhatsApp sessions will not survive restarts"],
      ["WHATSAPP_OTP_BASE_URL", "OTP bridge has no gateway address"],
      ["WHATSAPP_OTP_API_KEY", "OTP bridge cannot authenticate to the gateway"],
      ["WHATSAPP_OTP_SESSION", "OTP requests have no stable session id"],
    );
  }
  for (const [name, failureMode] of required) {
    report.checked++;
    if (!isSet(env, name)) report.add("error", name, `absent → ${failureMode}`);
  }

  // ── 2. Malformed URLs ──────────────────────────────────────────────────
  for (const name of ["DATABASE_URL", "PERSISTENCE_URL"]) {
    if (!isSet(env, name)) continue;
    report.checked++;
    const d = describeUrl(get(name));
    if (!d.ok || (d.scheme !== "postgres" && d.scheme !== "postgresql") || d.host === "") {
      report.add("error", name, "not a parseable postgres:// URL with a host");
      continue;
    }
    if (!/sslmode=/.test(get(name)!)) {
      report.add(
        "warning",
        name,
        "no sslmode parameter (Neon works but require is the documented shape)",
      );
    }
  }

  const origins = new Set<string>();
  if (isSet(env, "APP_URL")) {
    report.checked++;
    const d = describeUrl(get("APP_URL"));
    if (!d.ok) report.add("error", "APP_URL", "not a parseable URL");
    else {
      if (d.scheme !== "https")
        report.add(
          "warning",
          "APP_URL",
          `scheme is ${d.scheme}, not https (fine for local profiles only)`,
        );
      if (get("APP_URL")!.includes("*")) report.add("error", "APP_URL", "wildcard not allowed");
      if (/\/$/.test(get("APP_URL")!))
        report.add("warning", "APP_URL", "trailing slash (origins.ts strips it silently)");
      origins.add(get("APP_URL")!.replace(/\/+$/, ""));
    }
  }
  if (isSet(env, "APP_ORIGINS")) {
    report.checked++;
    for (const part of get("APP_ORIGINS")!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const d = describeUrl(part);
      if (!d.ok)
        report.add(
          "error",
          "APP_ORIGINS",
          `entry is not a parseable URL (reported by position, not value)`,
        );
      else if (part.includes("*")) report.add("error", "APP_ORIGINS", "wildcard entry not allowed");
      else origins.add(part.replace(/\/+$/, ""));
    }
  }
  if (isSet(env, "APP_ORIGIN")) {
    report.checked++;
    const d = describeUrl(get("APP_ORIGIN"));
    if (!d.ok) report.add("error", "APP_ORIGIN", "not a parseable URL");
    else if (!origins.has(get("APP_ORIGIN")!.replace(/\/+$/, ""))) {
      report.add(
        "warning",
        "APP_ORIGIN",
        "not part of the APP_URL/APP_ORIGINS set (deep links only)",
      );
    }
  }

  if (isSet(env, "WHATSAPP_OTP_BASE_URL")) {
    report.checked++;
    const d = describeUrl(get("WHATSAPP_OTP_BASE_URL"));
    if (!d.ok || (d.scheme !== "http" && d.scheme !== "https")) {
      report.add("error", "WHATSAPP_OTP_BASE_URL", "not a parseable http(s) URL");
    } else if (d.host === "openwa") {
      report.add(
        "info",
        "WHATSAPP_OTP_BASE_URL",
        "compose-internal service routing (expected shape)",
      );
    }
  }

  // ── 3. Placeholders / unsafe defaults ──────────────────────────────────
  for (const name of [
    ...SECRET_VARS,
    "DATABASE_URL",
    "PERSISTENCE_URL",
    "OPENWA_API_KEY",
    "WHATSAPP_OTP_API_KEY",
    "DASHBOARD_PASSWORD",
    "OTP_HMAC_KEY",
  ]) {
    if (!isSet(env, name)) continue;
    report.checked++;
    const v = get(name)!;
    if (PLACEHOLDER_RE.test(v)) {
      report.add(
        "error",
        name,
        `looks like a template placeholder (length ${v.length} — passes the boot length rules, which is exactly the trap)`,
      );
    } else if (templateValues.has(v)) {
      report.add("error", name, "equals a value literally present in a committed env template");
    }
  }

  // ── 4. Equal secrets ───────────────────────────────────────────────────
  const presentSecrets = [...SECRET_VARS].filter((n) => isSet(env, n));
  for (let i = 0; i < presentSecrets.length; i++) {
    for (let j = i + 1; j < presentSecrets.length; j++) {
      report.checked++;
      if (secretEqual(get(presentSecrets[i]), get(presentSecrets[j]))) {
        report.add(
          "error",
          `${presentSecrets[i]}+${presentSecrets[j]}`,
          "independent secrets are EQUAL",
        );
      }
    }
  }
  if (
    opts.profile === "compose" &&
    isSet(env, "WHATSAPP_OTP_API_KEY") &&
    isSet(env, "OPENWA_API_KEY")
  ) {
    report.checked++;
    if (!secretEqual(get("WHATSAPP_OTP_API_KEY"), get("OPENWA_API_KEY"))) {
      report.add(
        "error",
        "WHATSAPP_OTP_API_KEY+OPENWA_API_KEY",
        "must be EQUAL (gateway parity) but differ",
      );
    }
  }

  // ── 5. Shape rules (mirror boot) ───────────────────────────────────────
  for (const name of ["SESSION_SECRET", "ADMIN_JWT_SECRET"]) {
    if (!isSet(env, name)) continue;
    report.checked++;
    if (get(name)!.length < 32)
      report.add("error", name, `shorter than 32 chars (len ${get(name)!.length})`);
  }
  if (isSet(env, "ENCRYPTION_KEY")) {
    report.checked++;
    if (!isHex64(get("ENCRYPTION_KEY")))
      report.add("error", "ENCRYPTION_KEY", "not exactly 64 hex chars");
  }
  if (isSet(env, "OPENWA_CREDENTIALS_KEY")) {
    report.checked++;
    if (get("OPENWA_CREDENTIALS_KEY")!.length < 32) {
      report.add("warning", "OPENWA_CREDENTIALS_KEY", "shorter than the recommended 32 chars");
    }
  }
  const du = isSet(env, "DASHBOARD_USERNAME");
  const dp = isSet(env, "DASHBOARD_PASSWORD");
  if (du !== dp && (du || dp)) {
    report.checked++;
    report.add("error", "DASHBOARD_USERNAME/DASHBOARD_PASSWORD", "only one of the pair is set");
  } else if (dp && get("DASHBOARD_PASSWORD")!.length < 8) {
    report.checked++;
    report.add("error", "DASHBOARD_PASSWORD", "shorter than 8 chars");
  }

  // ── 6. Ports / numeric ranges ──────────────────────────────────────────
  for (const name of ["PORT", "API_PORT", "SUBNATION_HOST_PORT", "OPENWA_HOST_PORT"]) {
    const valid = isValidPort(get(name));
    if (valid === null) continue;
    report.checked++;
    if (!valid) report.add("error", name, "not a valid port (1-65535)");
  }
  if (isSet(env, "SCHEDULER_LEASE_TTL_SEC")) {
    report.checked++;
    const ttl = Number(get("SCHEDULER_LEASE_TTL_SEC"));
    if (Number.isFinite(ttl) && ttl < 10) {
      report.add(
        "warning",
        "SCHEDULER_LEASE_TTL_SEC",
        "below 10 — scheduler-coordinator silently floors it to 60",
      );
    }
  }

  // ── 7. Origin consistency ─────────────────────────────────────────────
  if (isSet(env, "VITE_APP_ORIGIN")) {
    report.checked++;
    if (!origins.has(get("VITE_APP_ORIGIN")!.replace(/\/+$/, ""))) {
      report.add(
        "error",
        "VITE_APP_ORIGIN",
        "set but NOT in the APP_URL/APP_ORIGINS set — canonical/SEO links would disagree with CORS",
      );
    }
  }
  if (origins.size > 0 && isSet(env, "APP_URL")) {
    report.checked++;
    if (!origins.has(get("APP_URL")!.replace(/\/+$/, ""))) {
      // unreachable by construction (APP_URL is folded into origins) — kept
      // for the day origins stop folding it in.
      report.add("error", "APP_URL", "origin not in the APP_ORIGINS allowlist");
    }
  }
  const splitRemnants = ["FRONTEND_ORIGINS", "VERCEL_FRONTEND_ORIGIN"].filter((n) => isSet(env, n));
  if (splitRemnants.length > 0 && (get("AUTH_COOKIE_SAMESITE") ?? "lax") === "lax") {
    report.checked++;
    report.add(
      "warning",
      splitRemnants.join(","),
      "split-deployment origins set on a single-origin stack (lax cookies)",
    );
  }

  // ── 8. Impossible / dangerous combinations ─────────────────────────────
  const truthy = (name: string) =>
    ["true", "1", "yes"].includes((get(name) ?? "").trim().toLowerCase());
  const isTrue = (name: string) => (get(name) ?? "").trim().toLowerCase() === "true";

  if (isTrue("DISABLE_WEB_SCHEDULERS") && !isSet(env, "WORKER_TIER")) {
    report.checked++;
    report.add(
      "error",
      "DISABLE_WEB_SCHEDULERS",
      "true with no WORKER_TIER — every cron/alert is silently dead",
    );
  }
  if (
    get("NODE_ENV") &&
    get("NODE_ENV") !== "production" &&
    opts.profile === "compose" &&
    [...origins].some((o) => o.startsWith("https://"))
  ) {
    report.checked++;
    report.add("warning", "NODE_ENV", "non-production value next to a https prod origin set");
  }
  const refresh = Number(get("SCHEDULER_LEASE_REFRESH_MS"));
  const ttlMs = Number(get("SCHEDULER_LEASE_TTL_SEC")) * 1000;
  if (Number.isFinite(refresh) && Number.isFinite(ttlMs) && refresh > ttlMs / 2) {
    report.checked++;
    report.add(
      "warning",
      "SCHEDULER_LEASE_REFRESH_MS",
      "exceeds TTL/2 — scheduler-coordinator silently caps it",
    );
  }
  const drain = Number(get("GRACEFUL_SHUTDOWN_TIMEOUT_MS"));
  if (Number.isFinite(drain) && drain > 40_000) {
    report.checked++;
    report.add(
      "error",
      "GRACEFUL_SHUTDOWN_TIMEOUT_MS",
      `drain budget (${drain} ms) exceeds the compose stop_grace_period (40 s) → SIGKILL mid-drain`,
    );
  }
  if (truthy("MIGRATIONS_FORCE_RECONCILE")) {
    report.checked++;
    report.add(
      "info",
      "MIGRATIONS_FORCE_RECONCILE",
      "next boot runs the FULL reconcile (fingerprint row rewritten)",
    );
  }
  if (isTrue("DISABLE_BOOT_MIGRATIONS")) {
    report.checked++;
    report.add("warning", "DISABLE_BOOT_MIGRATIONS", "escape hatch active — schema drift possible");
  }
  if (truthy("ALLOW_DEMO_SEED")) {
    report.checked++;
    report.add(
      "error",
      "ALLOW_DEMO_SEED",
      "demo catalog seeding enabled against a production env file",
    );
  }
  for (const name of ["VITE_API_BASE_URL", "VITE_SOCKET_URL", "VITE_API_URL"]) {
    if (isSet(env, name)) {
      report.checked++;
      report.add(
        "warning",
        name,
        "set in the compose profile — the single-origin contract wants these EMPTY (the #1 migration trap)",
      );
    }
  }
  if ((get("AUTH_COOKIE_SAMESITE") ?? "").toLowerCase() === "none" && splitRemnants.length === 0) {
    report.checked++;
    report.add(
      "warning",
      "AUTH_COOKIE_SAMESITE",
      "none on a single-origin stack weakens cookies for no reason",
    );
  }

  // ── Output ─────────────────────────────────────────────────────────────
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          errors: report.errors.map((f) => `${f.name}: ${f.message}`),
          warnings: report.warnings.map((f) => `${f.name}: ${f.message}`),
          info: report.infos.map((f) => `${f.name}: ${f.message}`),
          checked: report.checked,
        },
        null,
        2,
      ),
    );
  } else {
    for (const f of report.errors) console.error(`  ERROR   ${f.name}: ${f.message}`);
    for (const f of report.warnings) console.warn(`  WARN    ${f.name}: ${f.message}`);
    for (const f of report.infos) console.log(`  INFO    ${f.name}: ${f.message}`);
    console.log(
      `checked ${report.checked} rules — ${report.errors.length} error(s), ${report.warnings.length} warning(s)`,
    );
  }

  const failed = report.errors.length > 0 || (opts.strict && report.warnings.length > 0);
  process.exit(failed ? 1 : 0);
}

main();
