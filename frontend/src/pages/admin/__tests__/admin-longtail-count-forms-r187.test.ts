/**
 * R187-8 (fix squad, admin long-tail) — the R134 frozen-count and
 * verb-drift survivors on MY file set, pinned as source scans (the
 * admin-*-decomposition-r137 idiom: structural invariants a render
 * test only covers incidentally).
 *
 * R187L-F1 (the long-tail half — core-file sites belong to R187-7):
 * the storefront went 100% formatCount in R134; the admin family grew
 * the ALERT_COUNT_FORMS / TICKET_COUNT_FORMS idiom, but these sites
 * still froze a single Arabic form (and pricing rode a 1/other-only
 * ternary). Each enumerated site now rides formatCount with the
 * family's forms object; the frozen literals are banned from coming
 * back. The behavioral representatives are pinned where the surfaces
 * already render: pricing-console (the preview-armed confirm's
 * «3 باقات … 2 منتجان»), tickets-error-state («1 تذكرة بانتظار ردك»),
 * alerts-load-more (the footer's «30 تنبيهًا غير مقروء»).
 *
 * R187L-F4: the load-error verb — «تعذّر جلب» vs the repo-wide
 * «تعذّر تحميل» headline family — is now byte-extinct across ALL
 * non-test frontend source (the four system-section sites + the page's
 * thrown error string).
 *
 * R187E-F4: the tickets docblock's "next 25 s poll" claim (the
 * storefront support page's interval, never this page's) is gone.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R187L-F1 — the admin long-tail count sites ride formatCount (no frozen plurals)", () => {
  it("pricing.tsx: both recompute count sites pluralize (VARIANT/PRODUCT forms), no 1/other ternary", () => {
    const page = read("src/pages/admin/pricing.tsx");
    // The success toast + the preview-armed confirm.
    expect(page).toContain("formatCount(result.variants_updated, VARIANT_COUNT_FORMS)");
    expect(page).toContain("formatCount(result.products_updated, PRODUCT_COUNT_FORMS)");
    expect(page).toContain("formatCount(dryRun.variants_drifted, VARIANT_COUNT_FORMS)");
    expect(page).toContain("formatCount(dryRun.products_affected, PRODUCT_COUNT_FORMS)");
    // The frozen forms stay dead: the bare «باقة» count and the
    // 1/other-only منتج ternary that missed two/few/many.
    expect(page).not.toContain("} باقة عبر");
    expect(page).not.toContain('=== 1 ? "منتج" : "منتجات"');
  });

  it("ReferralsTable.tsx: the footer count rides the إحالة family, not «N إحالة»", () => {
    const table = read("src/components/admin/referrals/ReferralsTable.tsx");
    expect(table).toContain("formatCount(list.length, REFERRAL_COUNT_FORMS)");
    expect(table).not.toContain("`${list.length} إحالة`");
  });

  it("CoreWebVitalsSection.tsx: both sample-count sites ride the عيّنة family", () => {
    const src = read("src/components/admin/system/CoreWebVitalsSection.tsx");
    // The tile title + the visible sub-count (two call sites).
    expect(src.match(/formatCount\(samples, SAMPLE_COUNT_FORMS\)/g)?.length).toBe(2);
    expect(src).not.toContain("${samples} عيّنة");
    expect(src).not.toContain("{samples} عيّنة");
  });

  it("system.tsx: the rps chart window count rides the shared SAMPLE_COUNT_FORMS", () => {
    const page = read("src/pages/admin/system.tsx");
    expect(page).toContain("formatCount(Math.min(samples.length, 60), SAMPLE_COUNT_FORMS)");
    expect(page).not.toContain("{Math.min(samples.length, 60)} عيّنة");
  });

  it("HttpAnalyticsSection.tsx: the active-route sub-count pluralizes (compound forms)", () => {
    const src = read("src/components/admin/system/HttpAnalyticsSection.tsx");
    expect(src).toContain("formatCount(metrics.http.topRoutes.length, ROUTE_COUNT_FORMS)");
    expect(src).not.toContain("${metrics.http.topRoutes.length} مسار نشط");
  });

  it("RedisPerformanceSection.tsx: the degraded-events sub-count pluralizes", () => {
    const src = read("src/components/admin/system/RedisPerformanceSection.tsx");
    expect(src).toContain("formatCount(metrics.redis.degradedEvents, DEGRADE_COUNT_FORMS)");
    expect(src).not.toContain("${metrics.redis.degradedEvents} تخفيض");
  });

  it("alerts.tsx: the unread footer adjective rides the count noun's plural too", () => {
    const page = read("src/pages/admin/alerts.tsx");
    expect(page).toContain("· {formatCount(unreadCount, ALERT_COUNT_FORMS)} غير مقروء");
    expect(page).not.toContain("· {unreadCount} غير مقروء");
  });

  it("tickets.tsx: both header chips ride TICKET_COUNT_FORMS beside their adjectives", () => {
    const page = read("src/pages/admin/tickets.tsx");
    expect(page).toContain("{formatCount(pendingCount, TICKET_COUNT_FORMS)} نشطة");
    expect(page).toContain("{formatCount(awaitingReplyCount, TICKET_COUNT_FORMS)} بانتظار ردك");
    expect(page).not.toContain("{pendingCount} نشطة");
    expect(page).not.toContain("{awaitingReplyCount} بانتظار ردك");
  });
});

describe("R187L-F4 — the load-error verb is «تعذّر تحميل», byte-extinct «تعذّر جلب»", () => {
  /** Every non-test source file under frontend/src (the R187L audit's
   *  census found the drift ONLY in components/admin/system/* + the
   *  page's thrown error string; this pin keeps the whole tree honest). */
  function nonTestSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          walk(full);
        } else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          out.push(full);
        }
      }
    };
    walk(resolve(process.cwd(), "src"));
    expect(out.length, "the source census is non-empty").toBeGreaterThan(300);
    return out;
  }

  it("zero occurrences of «تعذّر جلب» across ALL non-test frontend source", () => {
    const offenders = nonTestSources().filter((f) => readFileSync(f, "utf8").includes("تعذّر جلب"));
    expect(offenders, `files still carrying the drifted verb: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the four healed system sites carry the repo-wide verb", () => {
    for (const [rel, healed] of [
      ["src/components/admin/system/HealthOverviewSection.tsx", "تعذّر تحميل حالة الصحة"],
      ["src/components/admin/system/HttpAnalyticsSection.tsx", "تعذّر تحميل مقاييس المراقبة"],
      [
        "src/components/admin/system/RuntimeDiagnosticsSection.tsx",
        "تعذّر تحميل تشخيص وقت التشغيل",
      ],
      ["src/components/admin/system/RecentAlertsSection.tsx", "تعذّر تحميل آخر التنبيهات"],
      ["src/pages/admin/system.tsx", "تعذّر تحميل بيانات المراقبة"],
    ] as const) {
      expect(read(rel), rel).toContain(healed);
    }
  });
});

describe("R187E-F4 — the tickets docblock tells the truth about re-sync", () => {
  it("tickets.tsx carries NO \"25 s poll\" claim (the storefront support page's interval, not this page's)", () => {
    const page = read("src/pages/admin/tickets.tsx");
    expect(page).not.toContain("25 s poll");
    expect(page).not.toContain("25s poll");
    // The honest re-sync story the docblock now tells (the comment wraps
    // across lines — pinned as its two single-line halves).
    expect(page).toContain("The operator's next open (or the");
    expect(page).toContain("socket-driven list refetch — this page has no polling) re-syncs the");
    expect(page).toContain("thread silently.");
  });
});
