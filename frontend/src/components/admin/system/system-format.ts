// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the KPI formatters (uptime compaction, Intl compact counts, the ms
// humanizer). React-free pure module — the page and every admin/system
// extract import from here; the move only changes its address, zero
// behavior change.

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  // 94-C2 (A2 P3-20): thin spaces between the digit and the Arabic
  // unit letter — «3ي 5س» read as a squashed token; «3 ي 5 س» scans.
  // U+2009 keeps the compact KPI style without a full space's width.
  if (d > 0) return `${d}\u2009ي ${h}\u2009س`;
  if (h > 0) return `${h}\u2009س ${m}\u2009د`;
  if (m > 0) return `${m}\u2009د ${s}\u2009ث`;
  return `${s}\u2009ث`;
}

// R120-B5 (A5-F13): the hand-rolled K/M compaction (`(n/1e6).toFixed(1)`)
// is now Intl's compact notation — the engine-generated version of the
// same output ("1.2K" / "3.4M", locale separators included), matching the
// shared-formatter convention the rest of the admin rides (utils.ts
// Intl.NumberFormatters). Tile UX is unchanged: counts stay compact.
const METRIC_COUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatNumber(n: number): string {
  return METRIC_COUNT_FORMATTER.format(n);
}

export function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v < 1) return "<1ms";
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}
