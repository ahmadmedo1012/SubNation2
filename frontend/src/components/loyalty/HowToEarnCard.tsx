import { Crown, ShoppingCart, Star, Users } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the "how to earn" card (the earn-rate rows + the honest tiers
// footnote). Presentational only: the rows are built from the
// pointsPerReferral / tierThresholds values the page resolved from the
// API payload (R115 A8 de-hardcode — the loyalty-history suite pins
// the 300/1500 threshold rows, the explicit earn rate and the two
// «مزايا قريباً» lines at the rendered level). The move only changes
// its address; DOM, classes and Arabic copy are byte-identical.

export function HowToEarnCard({
  pointsPerReferral,
  tierThresholds,
}: {
  pointsPerReferral: number;
  tierThresholds: Record<string, number>;
}) {
  const HOW_TO_EARN = [
    {
      icon: <Users className="w-4 h-4 text-status-info" />,
      bg: "bg-status-info/10",
      label: "إحالة صديق يُعتمد أول شحن له",
      points: `+${pointsPerReferral} نقطة`,
    },
    {
      icon: <ShoppingCart className="w-4 h-4 text-status-success" />,
      bg: "bg-status-success/10",
      label: "عند كل عملية شراء",
      /* R115 (A8 #6): the earn rate stated explicitly — floor(final paid
       * price) points, i.e. 1 point per 1 LYD. NOTE: unlike the referral
       * and conversion rates, the backend exposes NO earn-rate constant
       * (checkout.service awards floor(finalPrice) directly) — the 1:1
       * here pins the policy value in copy; if the award formula ever
       * changes, this line changes with it. */
      points: "نقطة لكل 1 د.ل مدفوع",
    },
    {
      icon: <Crown className="w-4 h-4 text-tier-silver" /> /* R128 (A1-F3): tier tokens */,
      bg: "bg-tier-silver/10",
      label: `المستوى الفضي (${tierThresholds.silver} د.ل إنفاق)`,
      /* R115 (A8 #7): «مزايا إضافية» was an unbacked promise — zero perk
       * implementations exist. Tiers are progress markers for now. */
      points: "مزايا قريباً",
    },
    {
      icon: <Star className="w-4 h-4 text-status-warning" />,
      bg: "bg-status-warning/10",
      label: `المستوى الذهبي (${tierThresholds.gold} د.ل إنفاق)`,
      points: "مزايا قريباً",
    },
  ];

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-5">
      <h2 className="font-bold text-sm mb-3">كيف تكسب النقاط؟</h2>
      <div className="space-y-2">
        {/* R139 (precision): the earn legend rows keep their boxed
            nested-tile register but drop the hover wash — read-only
            legend lines promise no interactivity (the 139-g audit-trail
            discipline); the value span gains tabular-nums (numbers
            from the API's rate/threshold fields). */}
        {HOW_TO_EARN.map((row, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 p-3 bg-muted/20 rounded-xl"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-7 h-7 rounded-lg ${row.bg} flex items-center justify-center shrink-0`}
              >
                {row.icon}
              </div>
              <span className="text-sm font-semibold leading-snug">{row.label}</span>
            </div>
            <span className="text-xs font-bold text-primary-text whitespace-nowrap tabular-nums">
              {row.points}
            </span>
          </div>
        ))}
      </div>
      {/* R115 (A8 #7): tiers are progress markers in this phase — the
          perks lines above promise nothing until perks actually
          ship. */}
      <p className="text-2xs text-muted-foreground mt-3 leading-relaxed">
        المستويات مؤشرات تقدّم في هذه المرحلة — سنُعلن عن مزاياها عند تفعيلها.
      </p>
    </div>
  );
}
