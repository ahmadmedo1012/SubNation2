import { ChevronLeft, Gift, Share2, Users, Wallet } from "lucide-react";
import { Link } from "wouter";
import { CopyButton } from "@/components/CopyButton";
import type { LoyaltyData } from "./loyalty-meta";

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the referral box (code + link copy rows, the three-step "how it
// works" strip, the /referrals CTA). Presentational only: the overview
// query stays in the page and `data` flows down as a value; the
// HOW_REFERRAL_WORKS strip is static content and rides along as a
// module-level const. The move only changes its address; DOM, classes
// and Arabic copy are byte-identical.

const HOW_REFERRAL_WORKS = [
  { icon: <Share2 className="w-4 h-4 text-primary" />, step: "1", text: "شارك رابط الإحالة" },
  { icon: <Users className="w-4 h-4 text-primary" />, step: "2", text: "صديقك يسجل حسابه" },
  /* R115 (policy B): اعتماد — a rejected first topup never credits. */
  {
    icon: <Wallet className="w-4 h-4 text-primary" />,
    step: "3",
    text: "يُعتمد أول شحن للمحفظة",
  },
];

export function ReferralBox({ data }: { data: LoyaltyData }) {
  return (
    <div className="bg-gradient-to-br from-primary/10 via-card to-card border border-primary/20 rounded-2xl p-5 float-in stagger-3">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-bold text-base mb-1">ادعُ أصدقاءك</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {/* R115 (policy B): اعتماد — the award lands on the
                friend's first APPROVED topup, not at signup. */}
            عند اشتراك صديقك واعتماد أول شحن له،
            <span className="text-status-warning font-bold">
              {" "}
              تحصل على {data.points_rate.points_per_referral} نقطة
            </span>
          </p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
          <Gift className="w-4.5 h-4.5 text-primary" />
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div
            dir="ltr"
            /* R122 (A1 P2-4): tracking-widest was a silent no-op — the
               global Arabic letter-spacing guard (index.css:917)
               zeroes the five tracking utilities app-wide, so the
               SAME referral code rendered with 0.2em spacing on
               /referrals and 0 here. Arbitrary form unified to
               tracking-[0.2em] for LTR mono runs. */
            className="flex-1 bg-background/50 border border-border rounded-xl px-3 py-2.5 font-mono text-sm font-bold tracking-[0.2em] truncate text-left"
          >
            {data.referral_code}
          </div>
          <CopyButton text={data.referral_code} label="نسخ" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div
            dir="ltr"
            className="flex-1 bg-background/40 border border-border/50 rounded-xl px-3 py-2 text-xs text-muted-foreground truncate font-mono text-left"
          >
            {data.referral_link || `${window.location.origin}/register?ref=${data.referral_code}`}
          </div>
          <CopyButton
            text={
              data.referral_link || `${window.location.origin}/register?ref=${data.referral_code}`
            }
            label="رابط"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
        {HOW_REFERRAL_WORKS.map((s) => (
          <div
            key={s.step}
            className="bg-background/40 border border-border/40 rounded-xl p-2.5 flex flex-col items-center gap-1.5"
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              {s.icon}
            </div>
            <div className="font-bold text-foreground/80 leading-tight">{s.text}</div>
          </div>
        ))}
      </div>
      {/* R122 (A1-P1): the Link wears the CTA classes directly —
          was a native button nested inside a Link (invalid
          interactive nesting + a doubled tab stop; lowercase
          markup slipped past the R120-B7 sweep's capitalized-only
          regex). min-h-11 rides the app-wide 44px tap-target floor
          while converting. */}
      <Link
        href="/referrals"
        /* R124-I1 (A3/A5 P2): text-primary-text — raw text-primary is
            the surface tone (~3.9:1 dark, sub-AA for this 14px bold
            CTA text); button.tsx's link variant pins the convention. */
        className="w-full min-h-11 py-2 flex items-center justify-center gap-2 rounded-xl bg-primary/8 hover:bg-primary/15 border border-primary/20 hover:border-primary/30 text-primary-text text-sm font-bold transition-all active:scale-[0.98] press-spring"
      >
        <Users className="w-3.5 h-3.5" />
        عرض سجل الإحالات الكامل
        <ChevronLeft className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
