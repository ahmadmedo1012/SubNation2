import { KeyRound } from "lucide-react";
// B14-5 (R127-L11): the auth-summary banner joins the repo's formatCount
// plural-router idiom (wallet.tsx / topups.tsx TOPUP_COUNT_FORMS).
import { formatCount } from "@/lib/utils";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «المصادقة» tab's summary banner (enabled-methods count with the
// B14-5 plural routing + the enabled/total pill). enabledCount and the
// providers total are page-derived values passed DOWN; the providers list
// underneath and every settings mutation stay page-owned. The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

export function AuthProvidersSummary({
  enabledCount,
  providersCount,
}: {
  enabledCount: number;
  providersCount: number;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 bg-card border border-border/60 rounded-2xl float-in">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <KeyRound className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1">
        <div className="font-bold text-sm">طرق تسجيل الدخول</div>
        <div className="text-xs text-muted-foreground">
          {/* 93-C7 / C-UX5 (A11 top-20 #6): the platform is
              passwordless for USERS (phone OTP + OAuth) — the old
              copy promised users a password login that does not
              exist; the admin's OWN password (AccountTab) is
              untouched. */}
          {/* B14-5 (R127-L11): formatCount plural routing — the
              frozen singular rendered «2 طريقة مفعّلة»/
              «3 طريقة مفعّلة» for n=2/n=3. */}
          {enabledCount === 0
            ? "لا توجد طرق مفعّلة — سيظهر للمستخدمين الدخول برقم الهاتف (رمز تحقق) فقط"
            : `${formatCount(enabledCount, {
                one: "طريقة مفعّلة",
                two: "طريقتان مفعّلتان",
                few: "طرق مفعّلة",
                many: "طريقة مفعّلة",
                other: "طريقة مفعّلة",
              })} إضافةً إلى الدخول برقم الهاتف (رمز تحقق)`}
        </div>
      </div>
      {/* R126-L5 (A3-4): the auth-summary pill joins the :889
          role-badge idiom on text-primary-text (raw text-primary
          on the /10 tint is 3.56:1 dark). */}
      {/* R139 (precision): the pill edge joins the static-badge family's
          single border value — border-primary/30 (139-f's lane-wide call:
          the InventoryUploadDialog «كود» badge + the calm-pill border) —
          and the enabled/total count rides tabular-nums (the numeric
          read-only register). */}
      <span
        className={`text-xs font-bold px-2.5 py-1 rounded-full border tabular-nums ${enabledCount > 0 ? "bg-primary/10 text-primary-text border-primary/30" : "bg-muted text-muted-foreground border-border"}`}
      >
        {enabledCount}/{providersCount}
      </span>
    </div>
  );
}
