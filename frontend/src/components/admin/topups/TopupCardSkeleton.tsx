// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue's loading skeleton card (rendered ×3 while the infinite query
// fetches). Pure presentational atom; the page still owns the
// isLoading branch that renders it. Byte-identical markup.

export function TopupCardSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4">
      <div className="flex items-center gap-4 mb-3">
        <div className="h-7 bg-muted skeleton-shimmer rounded-lg w-24" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-4 bg-muted skeleton-shimmer rounded-md w-full" />
        <div className="h-4 bg-muted skeleton-shimmer rounded-md w-4/5" />
      </div>
      <div className="h-9 bg-muted skeleton-shimmer rounded-xl" />
    </div>
  );
}
