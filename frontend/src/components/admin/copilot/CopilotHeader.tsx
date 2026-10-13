// R137 (2-a decomposition): the panel HEADER extracted verbatim from
// CopilotPanel.tsx. Presentational: flags + the current conversation title
// + callbacks only — the panel owns every toggle atom (history sidebar,
// action history, fullscreen, open) and the phase flags probe; the 93-C7 /
// C-UX2 phase-pill tone mapping (pure derivation) rides along verbatim.
// ZERO markup change: all six affordances (المحادثات / العنوان + pill /
// محادثة جديدة / سجل الإجراءات / ملء الشاشة / إغلاق) survive byte-identical.

import { Bot, History, Maximize2, Menu, Minimize2, Plus, X } from "lucide-react";
// 93-C7 / C-UX2 (A12 B13): the copilot phase pill migrates from raw
// emerald/amber/blue hues to the canonical StatusBadge tones on the
// --status-* tokens.
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { PhaseFlags } from "./copilot-types";

export function CopilotHeader({
  flags,
  currentTitle,
  fullscreen,
  onToggleHistory,
  onNewConversation,
  onToggleActionHistory,
  onToggleFullscreen,
  onClose,
}: {
  flags: PhaseFlags;
  currentTitle: string;
  fullscreen: boolean;
  onToggleHistory: () => void;
  onNewConversation: () => void;
  onToggleActionHistory: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  // 93-C7 / C-UX2 (A12 B13): phase pill rides StatusBadge tones —
  // نشط (phase3 execute) → success, مع موافقة (phase2) → warning,
  // قراءة (phase1) → info.
  const phaseBadge: { label: string; tone: StatusBadgeVariant } = flags.phase3_enabled
    ? { label: "نشط", tone: "success" }
    : flags.phase2_enabled
      ? { label: "مع موافقة", tone: "warning" }
      : { label: "قراءة", tone: "info" };

  return (
    /* R139 (precision): the header drops its decorative
       from-primary/5 gradient wash for the family's quiet chrome
       (border-b border-border → /60, no band — the panel's own surface
       carries it); the Bot tile joins the page-header icon-stage family
       (bg-primary/10 + border-primary/20 + primary ink — the gradient
       disc + shadow-lg + ring retire). */
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
      <button
        onClick={onToggleHistory}
        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        title="المحادثات"
        aria-label="المحادثات"
      >
        <Menu className="w-4 h-4" />
      </button>
      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm flex items-center gap-2">
          المساعد الذكي
          <StatusBadge variant={phaseBadge.tone} size="xs">
            {phaseBadge.label}
          </StatusBadge>
        </div>
        <div className="text-3xs text-muted-foreground truncate">{currentTitle}</div>
      </div>
      <button
        onClick={onNewConversation}
        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        title="محادثة جديدة"
        aria-label="محادثة جديدة"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleActionHistory}
        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        title="سجل الإجراءات"
        aria-label="سجل الإجراءات"
      >
        <History className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleFullscreen}
        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hidden sm:inline-flex"
        title={fullscreen ? "تصغير" : "ملء الشاشة"}
        aria-label={fullscreen ? "تصغير" : "ملء الشاشة"}
      >
        {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
      <button
        onClick={onClose}
        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        aria-label="إغلاق"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
