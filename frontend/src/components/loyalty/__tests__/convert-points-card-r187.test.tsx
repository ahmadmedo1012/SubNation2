/**
 * R187 (B-F6) — the below-minimum remainder's plural forms.
 *
 * ConvertPointsCard's below-minimum line routes its remainder through
 * formatCount, but the forms object carried few/many/other ONLY —
 * remainder 1 rendered «1 نقطة» and 2 rendered «2 نقطة» (the many-form
 * word for the dual and the singular). The family contract (StatsRow's
 * POINTS_COUNT_FORMS + utils.ts's six-way plural engine) carries the
 * full set; this suite pins the one/two branches the card missed.
 *
 * Component-level render (the topup-rows-r157.test.tsx idiom): the card
 * is a presentational shell — data + pointsPerLyd flow down as values,
 * so the plural branch is directly exercisable without the page's
 * queries.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvertPointsCard } from "@/components/loyalty/ConvertPointsCard";
import type { LoyaltyData } from "@/components/loyalty/loyalty-meta";

afterEach(cleanup);

/** The /api/loyalty payload shape the card maps (loyalty-meta.ts). */
function data(points: number): LoyaltyData {
  return {
    points,
    tier: "bronze",
    lifetime_spend: 0,
    referral_code: "SNABC12",
    referral_link: "",
    referrals_total: 0,
    referrals_credited: 0,
    referrals_pending: 0,
    points_value_lyd: (points / 100).toFixed(2),
    next_tier: null,
    points_rate: { points_per_referral: 50, points_per_lyd: 100 },
  };
}

function renderCard(points: number) {
  return render(
    <ConvertPointsCard
      data={data(points)}
      pointsPerLyd={100}
      convertPoints=""
      onConvertPointsChange={vi.fn()}
      converting={false}
      convertError={null}
      convertValidation={null}
      onConvert={vi.fn()}
    />,
  );
}

describe("R187 B-F6 — the below-minimum remainder's one/two plural branches", () => {
  it("remainder 1 reads «1 نقطة واحدة» (not the many-form «1 نقطة»)", () => {
    renderCard(99);
    expect(screen.getByText("1 نقطة واحدة")).toBeInTheDocument();
  });

  it("remainder 2 reads «2 نقطتان»", () => {
    renderCard(98);
    expect(screen.getByText("2 نقطتان")).toBeInTheDocument();
  });

  it("the existing few/many branches are unchanged (3 → نقاط, 11 → نقطة)", () => {
    renderCard(97);
    expect(screen.getByText("3 نقاط")).toBeInTheDocument();
    cleanup();
    renderCard(89);
    expect(screen.getByText("11 نقطة")).toBeInTheDocument();
  });
});
