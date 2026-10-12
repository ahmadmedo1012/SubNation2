// R137 (2-a decomposition): the conversations sidebar extracted verbatim
// from CopilotPanel.tsx. Presentational: the conversation list + currentId
// + callbacks only — the panel owns the conversations state, the
// selection persistence (saveCurrentId) and the delete/new mutations.
// ZERO markup change: the «محادثة جديدة» CTA, the B14-5 formatCount
// plural routing and the hover-revealed delete button survive
// byte-identical.

import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { formatCount } from "@/lib/utils";
import type { Conversation } from "./copilot-types";

export function ConversationSidebar({
  conversations,
  currentId,
  onNewConversation,
  onSelect,
  onDelete,
}: {
  conversations: Conversation[];
  currentId: string | null;
  onNewConversation: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="w-60 border-l border-border bg-background/50 flex flex-col">
      <div className="px-3 py-3 border-b border-border flex items-center gap-2">
        <button
          onClick={onNewConversation}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> محادثة جديدة
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {conversations.length === 0 && (
          <div className="text-2xs text-muted-foreground text-center py-4">لا توجد محادثات بعد</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group rounded-lg px-2 py-2 text-xs cursor-pointer flex items-start gap-2 transition-colors ${
              c.id === currentId
                ? "bg-primary/15 border border-primary/30"
                : "hover:bg-muted/50 border border-transparent"
            }`}
            onClick={() => {
              onSelect(c.id);
            }}
          >
            <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate leading-tight">{c.title}</div>
              <div className="text-3xs text-muted-foreground mt-0.5">
                {/* B14-5 (R127-L11): formatCount plural routing —
                    the frozen «N رسالة» rendered «2 رسالة»/
                    «3 رسالة» for the dual/plural counts. */}
                {formatCount(c.turns.length, {
                  one: "رسالة",
                  two: "رسالتان",
                  few: "رسائل",
                  many: "رسالة",
                  other: "رسالة",
                })}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all"
              aria-label="حذف"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
