// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// multilingual change-intent heuristic (the ask-vs-draft router the send
// loop consults) plus the empty-state suggestion copy moved to their own
// React-free module so the panel file shrinks to orchestration. ZERO
// behavior change: the panel imports looksLikeChangeIntent by name and
// EmptyState imports the suggestion arrays — every verb and string
// survives byte-identical.

// ──────────────────────────────────────────────────────────────────────
// Change-intent heuristic (multilingual)
// ──────────────────────────────────────────────────────────────────────

const CHANGE_VERBS_AR = [
  "حدّث",
  "حدث",
  "غيّر",
  "غير",
  "بدّل",
  "بدل",
  "عدّل",
  "عدل",
  "أضف",
  "اضف",
  "ضع",
  "اجعل",
  "احذف",
  "امسح",
  "إلغ",
  "ألغ",
  "ارفع",
  "اخفض",
  "زد",
  "نقص",
  "أرشف",
  "ارشف",
  "انشر",
  "rename",
];
const CHANGE_VERBS_EN = [
  "update",
  "change",
  "set",
  "edit",
  "modify",
  "rename",
  "add",
  "remove",
  "delete",
  "increase",
  "decrease",
  "raise",
  "lower",
  "publish",
  "archive",
  "unarchive",
];
export function looksLikeChangeIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return [...CHANGE_VERBS_AR, ...CHANGE_VERBS_EN].some((v) => t.includes(v.toLowerCase()));
}

export const ASK_SUGGESTIONS = [
  "كم منتجاً نشطاً عندنا؟",
  "اعرض المنتجات التي مخزونها أقل من 5",
  "ماذا تغيّر في لوحة الإدارة آخر 24 ساعة؟",
];
export const SUPER_SUGGESTIONS = [
  "غيّر سعر نتفلكس إلى 19.99",
  "زد مخزون سبوتيفاي بـ 10",
  "أرشف المنتج رقم 7",
];
