/**
 * R137 (FE) — the admin/system.tsx decomposition contract.
 *
 * The monitoring page was a 1,785-line single component (six polling
 * queries, a client-side rolling metrics buffer, ten inline panels and
 * every subcomponent — MetricCard, HealthTile, DetailsSection, the
 * STATUS_META map, the formatters — in one function) — the R136
 * wallet/checkout decomposition precedent applied here: orchestration
 * (pages/admin/system.tsx) + nineteen verbatim extracts under
 * components/admin/system/ (the R135 product.tsx contract, applied
 * verbatim).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the scheduler
 * banner's R108 mode tree, the settings-scope gate) is already pinned by
 * the two admin render suites (system-settings-gate /
 * system-scheduler-banner); this file guards the STRUCTURE so the
 * decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,785 lines at decomposition; the ceiling leaves room to grow
 *      without re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (directly, or by its consumer extract for the shared tiles —
 *      a dropped import = a section silently vanished);
 *   3. money-path ownership — the six observability queries, the two
 *      guarded fetchers (fetchAdminJson / fetchAdminHealthReady — the
 *      93-C6/SY-1 honest-error machinery), handleRefresh and the
 *      rolling metrics buffer (samplesRef + its polling effect) stay
 *      IN the page: a stale closure in a presentational extract could
 *      render fabricated readings out of an authorization outcome —
 *      exactly the bug class the R133 A3-F4 gate killed;
 *   4. state ownership — every cross-section value (the queries' data,
 *      the derived series, the scheduler banner tones) stays
 *      centralized in the page; the extracts take values + callbacks
 *      only;
 *   5. purity — the pure helper modules are React-free.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/system.tsx");

/** The extracts the page imports directly. */
const DIRECT_EXTRACTS = [
  "@/components/admin/system/system-charts",
  "@/components/admin/system/system-meta",
  "@/components/admin/system/system-scheduler",
  "@/components/admin/system/system-samples",
  "@/components/admin/system/system-types",
  "@/components/admin/system/DetailsSection",
  "@/components/admin/system/HealthOverviewSection",
  "@/components/admin/system/SchedulerDetailsSection",
  "@/components/admin/system/RuntimeDiagnosticsSection",
  "@/components/admin/system/HttpAnalyticsSection",
  "@/components/admin/system/AuthSecuritySection",
  "@/components/admin/system/RedisPerformanceSection",
  "@/components/admin/system/SocketJobsSection",
  "@/components/admin/system/CoreWebVitalsSection",
  "@/components/admin/system/RecentAlertsSection",
  "@/components/admin/system/ExternalDashboardsSection",
];

/** Every .tsx extract (the presentational units the hook sweep covers). */
const TSX_EXTRACTS = [
  "DetailsSection",
  "HealthTile",
  "MetricCard",
  "HealthOverviewSection",
  "SchedulerDetailsSection",
  "RuntimeDiagnosticsSection",
  "HttpAnalyticsSection",
  "AuthSecuritySection",
  "RedisPerformanceSection",
  "SocketJobsSection",
  "CoreWebVitalsSection",
  "RecentAlertsSection",
  "ExternalDashboardsSection",
  "system-charts",
  "system-meta",
];

describe("R137 (FE) — admin/system.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/system.tsx stays under the 1,000-line ceiling (was 1,785 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    for (const specifier of DIRECT_EXTRACTS) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the shared tiles are still imported by their consumers (MetricCard / HealthTile / the formatters ride inside the section extracts)", () => {
    // These render inside their consumer extracts, not the page — the
    // deletion guard for them lives at the CONSUMER's import (the
    // wallet LedgerEntryRow precedent).
    const health = read("src/components/admin/system/HealthOverviewSection.tsx");
    expect(health).toContain('from "@/components/admin/system/HealthTile"');
    expect(health).toContain('from "@/components/admin/system/system-format"');
    for (const name of [
      "RuntimeDiagnosticsSection",
      "HttpAnalyticsSection",
      "AuthSecuritySection",
      "RedisPerformanceSection",
    ]) {
      const src = read(`src/components/admin/system/${name}.tsx`);
      expect(src, name).toContain('from "@/components/admin/system/MetricCard"');
    }
    for (const name of [
      "SchedulerDetailsSection",
      "RuntimeDiagnosticsSection",
      "HttpAnalyticsSection",
      "AuthSecuritySection",
      "RedisPerformanceSection",
      "SocketJobsSection",
      "CoreWebVitalsSection",
    ]) {
      const src = read(`src/components/admin/system/${name}.tsx`);
      expect(src, name).toContain('from "@/components/admin/system/DetailsSection"');
    }
    // The lazy recharts bridge stays a single module-level singleton —
    // the page's rps chart and the sparkline card import the SAME one.
    const metricCard = read("src/components/admin/system/MetricCard.tsx");
    expect(metricCard).toContain('from "@/components/admin/system/system-charts"');
    expect(page).toContain('from "@/components/admin/system/system-charts"');
  });

  it("the money path stays IN the page (the queries, the guarded fetchers, the rolling buffer, handleRefresh, the scope gate)", () => {
    // The 93-C6/SY-1 + R133 A3-F4 honest-fetch machinery — a fabricated
    // reading is worse than a missing panel, so the fetchers must never
    // drift into a presentational extract where a stale closure could
    // bypass the SESSION_EXPIRED / !ok throws.
    expect(page).toContain("function fetchAdminJson<T>(url: string): () => Promise<T> {");
    expect(page).toContain(
      "async function fetchAdminHealthReady(): Promise<HealthzReadyResponse> {",
    );
    // The one-click refresh fan-out across all six queries.
    expect(page).toContain("const handleRefresh = () => {");
    // The rolling metrics buffer coordinates the metrics + diagnostics
    // queries — the sparkline series' single source of truth.
    expect(page).toContain("const samplesRef = useRef<MetricsSample[]>([]);");
    expect(page).toContain("if (!metricsQ.data || !diagQ.data) return;");
    // The settings-scope gate (R133 A3-F4) — deep-link 403 burst killer.
    expect(page).toContain('const canViewSystem = hasAdminPermission("settings");');
    expect(page).toContain("enabled: !!adminToken && canViewSystem,");
    // And all six polling queries stay page-owned (one queryKey each).
    for (const key of [
      '"admin-healthz-ready"',
      '"admin-diagnostics"',
      '"admin-observability-summary"',
      '"admin-observability-alerts-recent"',
      '"admin-observability-metrics"',
      '"admin-observability-scheduler"',
    ]) {
      expect(page, key).toContain(`queryKey: [${key}]`);
    }
  });

  it("the cross-section values stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the header pill, the health tiles, the scheduler
    // banners and every diagnostics panel key off the same derived
    // values — computed beside the queries they read.
    for (const atom of [
      "const health = healthQ.data;",
      "const metrics = metricsQ.data;",
      "const scheduler = schedulerQ.data;",
      "const recentAlerts = recentAlertsQ.data?.alerts ?? [];",
      "const aggregate = health?.status ??",
      "const samples = samplesRef.current.slice(-60);",
      "const { schedTone, schedTitle, schedMessage } = deriveSchedulerBanner(scheduler);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // And the derivation lives in the pure module the page imports by
    // name (never duplicated inline).
    const schedulerModule = read("src/components/admin/system/system-scheduler.ts");
    expect(schedulerModule).toContain("export function deriveSchedulerBanner(");
  });

  it("the moved markup rides along verbatim (spot-pins at the extracts' new addresses)", () => {
    // The two admin render suites pin the DOM through the page; these
    // spot-pins keep the money copy at its new address so a dropped
    // extract can't silently take the copy with it (the checkout
    // CartSummaryAside precedent).
    const schedulerModule = read("src/components/admin/system/system-scheduler.ts");
    expect(schedulerModule).toContain("الجدولة المضمّنة نشطة");
    expect(schedulerModule).toContain("خدمة worker المستقلة لا تستجيب");
    const health = read("src/components/admin/system/HealthOverviewSection.tsx");
    expect(health).toContain("نظرة سريعة على الصحة");
    expect(health).toContain("تعذّر تحميل حالة الصحة");
    const runtime = read("src/components/admin/system/RuntimeDiagnosticsSection.tsx");
    expect(runtime).toContain("وقت التشغيل والذاكرة (RSS · event-loop · إصدار · أعلام)");
    const http = read("src/components/admin/system/HttpAnalyticsSection.tsx");
    expect(http).toContain("تحليلات الطلبات HTTP (المسارات · حالات الاستجابة · زمن p50/p99)");
    // The page keeps its own money copy: the scope-gate honest reason +
    // the aggregate verdict pill (the settings-gate render suite's pins).
    expect(page).toContain("مركز المراقبة يتطلب صلاحية الإعدادات — تواصل مع مسؤول النظام");
    expect(page).toContain("النظام يعمل");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (values + callbacks only — no hook islands)", () => {
    // Stateless by contract: every value a panel needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the monitoring page is how a fabricated-
    // reading regression happens.
    for (const name of TSX_EXTRACTS) {
      const src = read(`src/components/admin/system/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the pure helper modules are React-free (types, formatters, buffer math, scheduler tones)", () => {
    for (const name of ["system-types", "system-format", "system-samples", "system-scheduler"]) {
      const src = read(`src/components/admin/system/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // Spot-pin the moved constants so they can't silently drift.
    expect(read("src/components/admin/system/system-samples.ts")).toContain(
      "export const MAX_SAMPLES = 120; // 30 min @ 15 s polling",
    );
    expect(read("src/components/admin/system/system-format.ts")).toContain(
      'const METRIC_COUNT_FORMATTER = new Intl.NumberFormat("en-US", {',
    );
    // STATUS_META keeps its Arabic tone labels + rides the theme tokens.
    const meta = read("src/components/admin/system/system-meta.tsx");
    expect(meta).toContain('label: "متاح"');
    expect(meta).toContain('border: "border-status-warning/20"');
  });
});
