#!/usr/bin/env node
/**
 * Postgres backup script — `pg_dump | gzip > <timestamp>.sql.gz`.
 *
 * Usage:
 *   pnpm tsx scripts/src/backup-db.ts                       # local file under ./backups/
 *   BACKUP_DIR=/var/backups pnpm tsx scripts/src/backup-db.ts
 *   BACKUP_PRESIGNED_PUT_URL=https://... pnpm tsx scripts/src/backup-db.ts
 *
 * Requirements:
 *   - `pg_dump` on PATH (Render's Node base image has it; locally
 *     `apt install postgresql-client` or `brew install libpq`).
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
 * Retention is the operator's responsibility — set a lifecycle rule on the
 * bucket (e.g. "keep daily for 14 days, then delete"). The script doesn't
 * manage retention because lifecycle rules are cheaper and more reliable
 * than client-side enumerate-and-delete.
 *
 * Exit codes:
 *   0 — success
 *   1 — generic error (pg_dump failed, write failed, etc.)
 *   2 — DATABASE_URL not set
 *   3 — pg_dump not found on PATH
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is not set");
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
  const pgDump = spawn(
    "pg_dump",
    [
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      "--quote-all-identifiers",
      "--serializable-deferrable",
      databaseUrl,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  pgDump.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("✗ pg_dump not found on PATH. Install postgresql-client.");
      process.exit(3);
    }
    console.error("✗ pg_dump spawn failed:", err);
    process.exit(1);
  });

  // Stream stderr so dump errors surface in the cron job log
  pgDump.stderr.on("data", (chunk) => {
    process.stderr.write(`[pg_dump] ${chunk}`);
  });

  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(filepath);

  try {
    await pipeline(pgDump.stdout, gzip, out);
  } catch (err) {
    console.error("✗ pipeline failed:", err);
    process.exit(1);
  }

  // Wait for pg_dump to actually exit
  const code: number = await new Promise((resolveExit) => pgDump.on("close", resolveExit));
  if (code !== 0) {
    console.error(`✗ pg_dump exited with code ${code}`);
    process.exit(1);
  }

  const stats = await stat(filepath);
  const elapsedMs = Date.now() - start;
  console.log(
    `✓ wrote ${(stats.size / 1024 / 1024).toFixed(2)} MB in ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  // ── Optional upload via presigned PUT URL ──
  const presignedUrl = process.env.BACKUP_PRESIGNED_PUT_URL?.trim();
  if (presignedUrl) {
    console.log(`→ uploading to presigned URL (host=${new URL(presignedUrl).host})`);
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(filepath);
    const uploadStart = Date.now();
    const response = await fetch(presignedUrl, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(stats.size),
      },
    });
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

  console.log(`✓ backup complete: ${filename}`);
  // Suppress the unused dirname import warning by referencing it once.
  void dirname;
}

main().catch((err) => {
  console.error("✗ unexpected:", err);
  process.exit(1);
});
