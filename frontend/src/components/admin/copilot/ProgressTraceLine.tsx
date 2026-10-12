// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// tool-trace progress line renderer (the R128-A6 emoji→lucide render
// swap). CopilotPanel re-exports it so the R129-B1 render pin test's
// import path (`…/copilot/CopilotPanel`) resolves unchanged. ZERO markup
// change: the glyph transport stays string-shaped, the render arms are
// byte-identical.

import {
  Check,
  FileText,
  History,
  Package,
  Pencil,
  Search,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ────────────────────────────────────────────────────────────────────
// R128-A6 (P4-4): the tool-trace progress lines were emoji-as-icon
// residue (🔍📋📦📜✏️⚙️🔧 labels + ✓/✗ status glyphs — progressFor
// builds plain strings, and the render printed them verbatim in the
// mono feed). The string TRANSPORT stays untouched (SSE handler,
// appendProgress/replaceLastProgress, persisted conversations, and
// their tests all key off strings); the RENDER layer now swaps the
// leading glyph for the lucide vocabulary — AT reads the Arabic label
// only, the icon carries the tool/status semantics.
// ────────────────────────────────────────────────────────────────────
const PROGRESS_TOOL_ICONS: Record<string, LucideIcon> = {
  "🔍": Search, // resolve_product / search_products
  "📋": FileText, // get_product
  "📦": Package, // list_low_stock / update_stock
  "📜": History, // summarize_recent_changes
  "✏️": Pencil, // update_product
  "⚙️": Settings, // admin_request
  "🔧": Wrench, // unknown-tool fallback
};

/** R129-B1: exported for the tool-trace render pin test. */
export function ProgressTraceLine({ line }: { line: string }) {
  const lineClasses = "text-2xs text-muted-foreground font-mono leading-5 flex items-center gap-1";
  if (line.startsWith("✓ ")) {
    return (
      <div className={lineClasses}>
        <Check className="w-3 h-3 shrink-0 text-status-success" aria-hidden />
        <span>{line.slice(2)}</span>
      </div>
    );
  }
  if (line.startsWith("✗ ")) {
    return (
      <div className={lineClasses}>
        <X className="w-3 h-3 shrink-0 text-destructive" aria-hidden />
        <span>{line.slice(2)}</span>
      </div>
    );
  }
  const emoji = Object.keys(PROGRESS_TOOL_ICONS).find((glyph) => line.startsWith(glyph));
  if (emoji) {
    const Icon = PROGRESS_TOOL_ICONS[emoji];
    return (
      <div className={lineClasses}>
        <Icon className="w-3 h-3 shrink-0" aria-hidden />
        <span>{line.slice(emoji.length).trimStart()}</span>
      </div>
    );
  }
  return <div className="text-2xs text-muted-foreground font-mono leading-5">{line}</div>;
}
