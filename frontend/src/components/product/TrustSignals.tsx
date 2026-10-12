import { Headphones, ShieldCheck, Truck } from "lucide-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the static three-up trust grid (the order-9 block of the buy panel).
// Zero props, zero state: the claims are page copy, not data — the
// component exists so the page file shrinks to orchestration. DOM and
// classes are byte-identical (the order-9 wrapper rides the component
// root, preserving the R117 F-1 gutter contract).
const TRUST_SIGNALS = [
  { icon: Truck, label: "تسليم فوري", desc: "حصل عليه فور الدفع" },
  { icon: ShieldCheck, label: "دفع آمن", desc: "من محفظتك المشحونة" },
  { icon: Headphones, label: "دعم متاح", desc: "تواصل معنا أي وقت" },
];

export function TrustSignals() {
  return (
    // Trust signals
    <div className="order-9 max-lg:px-5 grid grid-cols-3 gap-2">
      {TRUST_SIGNALS.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center gap-1 p-2.5 bg-muted/15 border border-border/35 rounded-xl text-center transition-colors hover:bg-muted/25 hover:border-border/55"
        >
          <item.icon className="w-5 h-5 text-muted-foreground mb-0.5" />
          {/* A1-F12 (R120-B2): label text-xs (was text-2xs) — the
              three conversion claims read as substance, not
              decoration, beside the 20px icons. */}
          <span className="text-xs font-bold text-foreground leading-tight">{item.label}</span>
          <span className="text-3xs text-muted-foreground leading-tight">{item.desc}</span>
        </div>
      ))}
    </div>
  );
}
