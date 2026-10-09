#!/usr/bin/env node
/**
 * Postgres backup script — `pg_dump | gzip > <timestamp>.sql.gz`.
 *
 * Usage:
 *   pnpm tsx scripts/src/backup-db.ts                       # local file under ./backups/
 *   pnpm tsx scripts/src/backup-db.ts --keep 30             # keep newest 30 local dumps
 *   BACKUP_DIR=/var/backups pnpm tsx scripts/src/backup-db.ts
 *   BACKUP_PRESIGNED_PUT_URL=https://... pnpm tsx scripts/src/backup-db.ts
 *
 * Requirements:
 *   - `pg_dump` on PATH (the Oracle VM host gets it via §9 of
 *     ORACLE_FINAL_SETUP.md — postgresql-client-17; locally `apt install
 *     postgresql-client` or `brew install libpq`). The app runtime image
 *     deliberately has NO pg_dump — backups run from the host, not the
 *     container (docs/DISASTER_RECOVERY.md §Automated backups).
 *   - DATABASE_URL set (the same value the app uses).
 *
 * Output:
 *   ./backups/subnation-<ISO-utc>.sql.gz
 *
 * If BACKUP_PRESIGNED_PUT_URL is set, the file is also HTTP PUT to that
 * URL after a successful local write. Use a presigned URL from any
 * S3-compatible provider (Backblaze B2, Cloudflare R2, AWS S3) — this
 * avoids pulling in @aws-sdk/client-s3 (~3 MB) for a script that runs once
 * a day. Generate the URL externally:
 *   - B2: aws s3 presign s3://bucket/path --expires-in 86400 --endpoint-url=...
 *   - R2: same with R2's S3-compatible endpoint
 *   - AWS: aws s3 presign s3://bucket/path --expires-in 86400
 *
 * (r110) Local retention: after a fully successful run (write + optional
 * upload) the oldest dumps beyond the newest `--keep <N>` (default 14) are
 * pruned from the backup dir. Only files matching the exact
 * `subnation-<ISO>.sql.gz` name pattern this script generates are ever
 * deleted — everything else in the dir is untouched. Off-VM copies are a
 * different tier: keep a lifecycle rule on the bucket (e.g. "keep daily for
 * 30 days, then delete") — lifecycle rules are cheaper and more reliable
 * than client-side enumerate-and-delete for the off-VM tier.
 *
 * (r110) Connection secrecy: DATABASE_URL is decomposed into libpq's PG*
 * environment variables (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE
 * and friends — pg_dump reads those natively) instead of being passed as a
 * pg_dump argument, so credentials never appear in the process list (`ps`).
 * URL-encoded components (user/password) are decoded, and URL query
 * parameters that have no PG* equivalent are dropped with a warning (pg_dump
 * would reject most of them as invalid connection options anyway).
 *
 * Exit codes:
 *   0 — success
 *   1 — generic error (pg_dump failed, write failed, etc.)
 *   2 — DATABASE_URL missing, unparseable, or without a database name
 *   3 — pg_dump not found on PATH
 *   4 — invalid usage (unknown flag, bad --keep value)
 */

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { createGzip, createGunzip } from "node:zlib";

// (r110) The exact filename pattern this script generates — the retention
// prune matches against this and NOTHING else, so a hand-dropped
// `subnation-manual.sql.gz` (or any other file) is never deleted.
const BACKUP_FILENAME_RE = /^subnation-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/;

/**
 * (r110) Pure retention helper: given every entry name in the backup dir and
 * the number of dumps to keep, return the names that should be deleted.
 * Lexicographic order of the ISO-8601 stamp in the name is chronological,
 * so the oldest `length - keep` names are the ones to prune.
 */
export function selectFilesToPrune(filenames: string[], keep: number): string[] {
  const backups = filenames.filter((name) => BACKUP_FILENAME_RE.test(name)).sort();
  return keep >= backups.length ? [] : backups.slice(0, backups.length - keep);
}

// (r110) libpq connection-string query parameters that map 1:1 to a PG*
// environment variable. `application_name` is the one spelling exception
// (PGAPPNAME, not PGAPPLICATION_NAME). Parameters with no env equivalent are
// dropped with a warning — names only, never values.
const PG_ENV_BY_PARAM: Record<string, string> = {
  sslmode: "PGSSLMODE",
  channel_binding: "PGCHANNELBINDING",
  connect_timeout: "PGCONNECT_TIMEOUT",
  client_encoding: "PGCLIENTENCODING",
  application_name: "PGAPPNAME",
  options: "PGOPTIONS",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  sslpassword: "PGSSLPASSWORD",
  sslcrl: "PGSSLCRL",
  sslcrldir: "PGSSLCRLDIR",
  gssencmode: "PGGSSENCMODE",
  requiressl: "PGREQUIRESSL",
  krbsrvname: "PGKRBSRVNAME",
};

// (r110) decodeURIComponent() throws on malformed escapes — pass those
// through verbatim instead of killing the backup over a character.
function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * (r110) Pure helper: decompose a postgres:// URL into libpq PG* env vars so
 * pg_dump needs no connection info on its command line. URL-encoded user /
 * password components are decoded (Neon passwords regularly contain @ : /).
 * Throws a plain Error when the value is not a parseable URL or has no
 * database name.
 */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a parseable postgres:// URL");
  }

  const env: Record<string, string> = {};

  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1); // (r110) IPv6 literal — drop the URL brackets
  }
  if (host) env.PGHOST = host;
  env.PGPORT = url.port || "5432";
  if (url.username) env.PGUSER = decodeMaybe(url.username);
  if (url.password) env.PGPASSWORD = decodeMaybe(url.password);

  const database = url.pathname.length > 1 ? decodeMaybe(url.pathname.slice(1)) : "";
  if (!database) {
    throw new Error("DATABASE_URL has no database name (postgres://host/<dbname>)");
  }
  env.PGDATABASE = database;

  const dropped: string[] = [];
  for (const [param, value] of url.searchParams) {
    const envName = PG_ENV_BY_PARAM[param];
    if (envName) env[envName] = value;
    else dropped.push(param);
  }
  if (dropped.length > 0) {
    // names only — parameter values are not printed
    console.warn(
      `⚠ ignoring DATABASE_URL parameter(s) with no pg_dump equivalent: ${dropped.join(", ")}`,
    );
  }
  return env;
}

// (r110) Strict argv parsing — a typo'd flag in a cron job must fail fast
// instead of being silently ignored. `--keep <N>` / `--keep=<N>`, default 14,
// minimum 1 (`--keep 0` would prune the backup it just wrote).
function usageError(message: string): never {
  console.error(`✗ ${message}`);
  console.error("  usage: backup-db.ts [--keep <N>]");
  process.exit(4);
}

function parseKeepArg(argv: string[]): number {
  let keep = 14;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--keep" && !arg.startsWith("--keep=")) {
      usageError(`unknown argument "${arg}"`);
    }
    const value = arg === "--keep" ? argv[++i] : arg.slice("--keep=".length);
    if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
      usageError(`--keep must be a positive integer (got "${value ?? ""}")`);
    }
    keep = Number(value);
  }
  return keep;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(2);
  }

  // (r110) usage errors fail fast BEFORE any file or child process exists.
  const keep = parseKeepArg(process.argv.slice(2));

  // (r110) libpq reads PG* env natively — keep pg_dump's argv secret-free.
  let pgEnv: Record<string, string>;
  try {
    pgEnv = pgEnvFromUrl(databaseUrl);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const backupDir = resolve(process.env.BACKUP_DIR ?? "./backups");
  await mkdir(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `subnation-${stamp}.sql.gz`;
  const filepath = join(backupDir, filename);

  console.log(`→ pg_dump → gzip → ${filepath}`);
  console.log(`  host=${hostname()} pid=${process.pid} started=${new Date().toISOString()}`);

  const start = Date.now();

  // pg_dump options:
  //   --no-owner            don't INCLUDE GRANT/OWNER (portable across roles)
  //   --no-privileges       same: skip GRANT statements
  //   --format=plain        SQL text (works with any psql version on restore)
  //   --quote-all-identifiers  defensive against reserved-word collisions
  //   --serializable-deferrable  consistent snapshot
  // (r110) R109 §27 P2 fix: connection info travels in the PG* environment
  // (see pgEnvFromUrl), so `ps` on the backup host never sees the connstring
  // or password — the old argv connstring leaked DATABASE_URL to every
  // local user via the process list.
  const pgDump = spawn(
    "pg_dump",
    [
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      "--quote-all-identifiers",
      "--serializable-deferrable",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...pgEnv } },
  );

  // (F3) spawn errors are handled via the unified exit-signal promise
  // below — an early process.exit(3) here would race the pipeline and
  // skip the partial-file cleanup.

  // Stream stderr so dump errors surface in the cron job log
  pgDump.stderr.on("data", (chunk) => {
    process.stderr.write(`[pg_dump] ${chunk}`);
  });

  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(filepath);

  // F3 (round-94 A6): a failed dump must never leave a partial file on
  // disk under a valid-looking `subnation-<ISO>.sql.gz` name — the only
  // discovery moment for a corrupt backup is the actual restore day.
  // Every failure path below removes the partial artifact BEFORE exiting.
  async function fail(message: string, code = 1): Promise<never> {
    console.error(message);
    try {
      await unlink(filepath);
      console.error(`✗ removed partial backup file: ${filename}`);
    } catch {
      // file was never created / already removed
    }
    process.exit(code);
  }

  // F3: unify the exit signals — the spawn 'error' event (pg_dump missing
  // from PATH) used to process.exit(3) from inside an event handler before
  // the pipeline settled, which also skipped any cleanup. Registered here,
  // awaited AFTER the pipeline (draining stdout) so a full pipe can never
  // deadlock the child; first signal wins, resolve is idempotent.
  const exitInfoPromise = new Promise<{ code: number | null; spawnError: Error | null }>(
    (resolveExit) => {
      pgDump.on("error", (err: Error) => resolveExit({ code: null, spawnError: err }));
      pgDump.on("close", (code: number | null) => resolveExit({ code, spawnError: null }));
    },
  );

  try {
    await pipeline(pgDump.stdout, gzip, out);
  } catch (err) {
    await fail(`✗ pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const exitInfo = await exitInfoPromise;

  // F3: pg_dump success is the EXIT CODE, not the pipeline settling — a
  // dump that dies mid-stream still pipes a valid gzip of PARTIAL SQL.
  if (exitInfo.spawnError) {
    const err = exitInfo.spawnError as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      await fail("✗ pg_dump not found on PATH. Install postgresql-client.", 3);
    }
    await fail(`✗ pg_dump spawn failed: ${err.message}`);
  }
  if (exitInfo.code !== 0) {
    await fail(`✗ pg_dump exited with code ${exitInfo.code} — backup discarded`);
  }

  const stats = await stat(filepath);
  const elapsedMs = Date.now() - start;
  console.log(
    `✓ wrote ${(stats.size / 1024 / 1024).toFixed(2)} MB in ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  // (r112 §17) Gzip integrity verification: re-read the artifact and push it
  // through a full gunzip pass — Node's zlib verifies the stored CRC32 and
  // ISO-3309 trailer during decompression, so a torn write (disk filled at
  // the trailer, truncated fsync, bit rot) fails HERE with exit 1 + artifact
  // removal instead of being discovered on restore day. A backup is not
  // "successful" until it has been proven decompressible.
  const verifyStart = Date.now();
  let verifiedBytes = 0;
  // A counting Writable sink. (R112 debugging note: an async-generator sink
  // with `yield` makes the pipeline promise NEVER settle — Node exits with
  // an unsettled top-level await and the post-verification code silently
  // never runs. A Writable sink has no such failure mode.)
  const countSink = new Writable({
    write(chunk: Buffer, _enc, cb: (err?: Error | null) => void) {
      verifiedBytes += chunk.byteLength;
      cb();
    },
  });
  try {
    await pipeline(createReadStream(filepath), createGunzip(), countSink);
  } catch (err) {
    await fail(
      `✗ gzip integrity check FAILED (artifact corrupt): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (verifiedBytes === 0) {
    await fail("✗ gzip integrity check failed: gunzip produced 0 bytes (empty dump)");
  }
  console.log(
    `✓ gzip integrity verified: ${verifiedBytes.toLocaleString()} decompressed bytes in ${(
      (Date.now() - verifyStart) /
      1000
    ).toFixed(1)}s`,
  );

  // ── Optional upload via presigned PUT URL ──
  const presignedUrl = process.env.BACKUP_PRESIGNED_PUT_URL?.trim();
  if (presignedUrl) {
    console.log(`→ uploading to presigned URL (host=${new URL(presignedUrl).host})`);
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(filepath);
    const uploadStart = Date.now();
    // R126-L7 (T3 / A10 §1.5): this PUT carried NO timeout or signal — a
    // stalled S3 endpoint hung the production backup cron indefinitely
    // (there is no race wrapper here, unlike validate.ts). The deadline
    // is size-aware: 2 min base + a 1 MiB/s floor for the body —
    // generous for a 100s-of-MB gzip on a slow uplink, finite for a
    // dead one.
    const uploadDeadlineMs = 120_000 + Math.ceil((stats.size / (1024 * 1024)) * 1_000);
    console.log(
      `  upload deadline: ${Math.round(uploadDeadlineMs / 1000)}s for ${(
        stats.size /
        (1024 * 1024)
      ).toFixed(1)} MiB`,
    );
    let response: Response;
    try {
      response = await fetch(presignedUrl, {
        method: "PUT",
        body,
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": String(stats.size),
        },
        signal: AbortSignal.timeout(uploadDeadlineMs),
      });
    } catch (err) {
      console.error(
        `✗ upload failed after ${((Date.now() - uploadStart) / 1000).toFixed(1)}s: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      process.exit(1);
    }
    if (!response.ok) {
      const respBody = await response.text();
      console.error(`✗ upload failed: HTTP ${response.status} ${respBody.slice(0, 200)}`);
      process.exit(1);
    }
    console.log(
      `✓ uploaded in ${((Date.now() - uploadStart) / 1000).toFixed(1)}s (HTTP ${response.status})`,
    );
  } else {
    console.log("ℹ BACKUP_PRESIGNED_PUT_URL not set — backup stays local only");
  }

  // (r110) Local retention — pruned only AFTER a fully successful run (write
  // + optional upload), so a failed night never deletes the last good
  // backup. selectFilesToPrune returns only names matching the exact
  // generated pattern; anything else in the dir is never touched.
  try {
    const dirEntries = await readdir(backupDir);
    const toPrune = selectFilesToPrune(dirEntries, keep);
    for (const name of toPrune) {
      try {
        await unlink(join(backupDir, name));
        console.log(`✓ pruned old backup (keep=${keep}): ${name}`);
      } catch (err) {
        // the artifact itself is safe — a prune failure only costs disk
        console.warn(
          `⚠ could not prune ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `⚠ retention prune skipped (could not list ${backupDir}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  console.log(`✓ backup complete: ${filename}`);
}

main().catch((err) => {
  console.error("✗ unexpected:", err);
  process.exit(1);
});
