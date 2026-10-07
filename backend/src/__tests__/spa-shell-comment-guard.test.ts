import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { initTestDb } from "../test/db";

/**
 * R122 (A7-P2) — the d22f24e comment-balance guard.
 *
 * rewriteOutsideComments splits the shell on CLOSED comments only
 * (/(<!--[\s\S]*?-->)/). With an UNCLOSED `<!--` in the template, the
 * split yields one giant "non-comment" segment and the <title> rewrite
 * pairs the COMMENT's `<title>` prose with the REAL title's closer —
 * deleting everything between (the original incident: the canonical
 * link and every og:/twitter: tag vanished from /category/* shells,
 * silently). The A7 verbatim-code simulation reproduced the exact
 * corruption class; these tests pin the boot-time guard that refuses to
 * run the rewriter on an imbalanced shell:
 *
 *   - shellCommentsBalance unit cases (balanced / unclosed / orphan
 *     closer / comment-free);
 *   - the REAL shipped template (frontend/index.html — the source the
 *     dist shell is built from) stays balanced, so a future edit that
 *     re-opens the bug class fails HERE at CI time;
 *   - the boot degrade: an app booted against an IMBALANCED stub serves
 *     the UNREWRITTEN shell byte-identically (baseline meta, homepage
 *     canonical left alone) instead of letting the rewriter corrupt it.
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

/** An IMBALANCED stub: a comment that mentions <title> in prose and never closes. */
const IMBALANCED_STUB_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<!-- MetaTags upsert-by-selector — one <title>, one description, one og set
<title data-rh="true">SubNation — سوق الاشتراكات الرقمية</title>
<meta name="robots" content="index,follow">
<meta name="description" content="BASELINE DESCRIPTION">
<link rel="canonical" href="https://subnation.ly/">
</head>
<body><div id="root">SUBNATION-IMBALANCED-STUB</div></body>
</html>`;
const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-shell-guard-"));
writeFileSync(path.join(stubDistDir, "index.html"), IMBALANCED_STUB_HTML);
// Must be set before the dynamic import below — app.ts reads (and guards)
// the shell at module load.
process.env.FRONTEND_DIST = stubDistDir;

const UA_BROWSER =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

type AppModule = typeof import("../app");
let appModule: AppModule;
let realApp: Express;

beforeAll(async () => {
  await initTestDb();
  appModule = await import("../app");
  realApp = appModule.default;
}, 60_000);

afterAll(() => {
  // Keep the throwaway FRONTEND_DIST from leaking into sibling test files
  // sharing this worker process.
  delete process.env.FRONTEND_DIST;
  rmSync(stubDistDir, { recursive: true, force: true });
});

async function get(pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = realApp.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${pathname}`, {
          headers: { "User-Agent": UA_BROWSER },
        });
        resolve({ status: res.status, body: await res.text() });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

// ── Unit: the balance predicate ──────────────────────────────────────────────

describe("shellCommentsBalance (R122 A7-P2) — units", () => {
  it("a balanced shell passes (multiple comments, prose mentioning tags)", () => {
    expect(
      appModule.shellCommentsBalance(
        `<!-- one <title> here --><title>X</title><!-- two <link rel="canonical"> -->`,
      ),
    ).toBe(true);
  });

  it("an UNCLOSED comment fails (the d22f24e shape — the split would treat the whole tail as markup)", () => {
    expect(appModule.shellCommentsBalance(`<!-- never closed <title>Y</title>`)).toBe(false);
  });

  it("an orphan closer fails too (symmetry: counts must match exactly)", () => {
    expect(appModule.shellCommentsBalance(`<!-- a --> -->`)).toBe(false);
    expect(appModule.shellCommentsBalance(`<!-- a --><!-- b --> --> -->`)).toBe(false);
  });

  it("a comment-free document trivially balances", () => {
    expect(appModule.shellCommentsBalance(`<html><body>Y</body></html>`)).toBe(true);
  });
});

// ── The real shipped template stays balanced (CI-time guard) ────────────────

describe("frontend/index.html — the shipped shell template balances (R122 A7-P2)", () => {
  it("the repo's frontend/index.html has equal <!-- and --> counts (an unclosed edit fails HERE before it ships)", () => {
    // The parity-test pattern (spa-shell-category-parity.test.ts): read
    // the frontend source as TEXT — no cross-tree import.
    const template = readFileSync(
      path.resolve(import.meta.dirname, "../../../frontend/index.html"),
      "utf8",
    );
    expect(appModule.shellCommentsBalance(template)).toBe(true);
  });
});

// ── Boot degrade: an imbalanced shell never enters the rewriter ─────────────

describe("boot with an IMBALANCED shell — the rewriter refuses to run (R122 A7-P2)", () => {
  it("/category/vpn serves the UNTOUCHED stub (baseline title + homepage canonical — the d22f24e corruption is impossible)", async () => {
    const r = await get("/category/vpn");
    expect(r.status).toBe(200);
    // The shell itself still ships (the site boots — the guard degrades,
    // it does not take the page down).
    expect(r.body).toContain("SUBNATION-IMBALANCED-STUB");
    // Byte-identical to the stub file: SPA_SHELL_HTML was nulled at boot,
    // so the fallback served the file UNREWRITTEN. The OLD behavior (the
    // d22f24e class) would have rewritten the title to the category meta
    // and DELETED the canonical + description tags by pairing the
    // comment's "<title>" prose with the real closer.
    expect(r.body).toBe(IMBALANCED_STUB_HTML);
    expect(r.body).toContain('<title data-rh="true">SubNation — سوق الاشتراكات الرقمية</title>');
    expect(r.body).toContain('href="https://subnation.ly/"');
  });
});
