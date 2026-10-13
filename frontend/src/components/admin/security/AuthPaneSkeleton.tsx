// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the auth pane's page-shaped FIRST-LOAD skeleton (the alerts.tsx card
// recipe): stats grid + filter bar + timeline rows keep their shape
// while the first window is in flight. Carries the A6-B8 role="status"
// + sr-only label pair. Zero hooks, zero props — the `loading` gate
// (activitiesQuery.isPending && !data) stays in the page.

// R139 (precision): the three skeleton frames mirror the real panes' new
// /60 resting edge (the AuthStatsGrid / AuthFiltersCard / timeline card
// all stepped /55→/60 this round) — the loading→loaded swap must never
// flash a frame weight the loaded surface doesn't ride (the route-
// skeleton parity discipline).

export function AuthPaneSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">جارٍ التحميل…</span>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] rounded-xl skeleton-shimmer border border-border/60" />
        ))}
      </div>
      <div className="h-[76px] rounded-xl skeleton-shimmer border border-border/60" />
      <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
        <div className="h-5 w-24 skeleton-shimmer rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] rounded-lg skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}
