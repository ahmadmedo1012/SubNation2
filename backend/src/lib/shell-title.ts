/**
 * R179 (RH-55 follow-up): the raw shell's 60-char title clamp.
 *
 * This must stay VERBATIM with frontend/src/components/seo/MetaTags.tsx
 * `clamp(title, 60, true)`: the raw HTML title and the hydrated title are
 * compared by the parity suites, and a split title is a SERP defect. The
 * brand-aware branch keeps a long title's « | SubNation» suffix instead of
 * spending the budget on the pipe and shipping «… |…».
 *
 * Kept out of spa-shell.ts (growth-banned at 1,039 lines).
 */
const MAX_TITLE = 60;

export function clampSeoTitle(title: string): string {
  if (title.length <= MAX_TITLE) return title;
  const sep = title.lastIndexOf(" | ");
  if (sep > 0) {
    const suffix = title.slice(sep);
    const budget = MAX_TITLE - 1 - suffix.length;
    if (budget >= 12) {
      const body = title.slice(0, sep);
      const sliced = body.slice(0, budget).trimEnd();
      const lastSpace = sliced.lastIndexOf(" ");
      const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
      return cut.trimEnd() + "…" + suffix;
    }
  }
  // R142 (K-1): word-boundary cut; a single unbroken word longer than the
  // budget still falls back to the character cut.
  const sliced = title.slice(0, Math.max(0, MAX_TITLE - 1)).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return cut.trimEnd() + "…";
}
