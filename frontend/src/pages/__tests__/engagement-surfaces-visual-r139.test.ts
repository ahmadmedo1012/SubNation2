/**
 * R139 (precision) — the ENGAGEMENT long-tail chrome pin suite.
 *
 * Wave-3 storefront lane (139-m): profile, notifications, support (+ the
 * components/support/ extracts + SessionManager — the profile page's own
 * sessions section), onboarding, terms, and the two auth bridge pages.
 * The r138 designer-lens idioms those pages adopted this round, frozen
 * as SOURCE-scan contracts (the money-path-chrome-r139 / admin-*-visual-
 * r139 craft: readFileSync + string/regex assertions, comments stripped
 * so the rationale blocks that NAME retired classes can't false-fire):
 *
 *   1. canonical CTAs      — the four support hand-rolls (incl. the
 *      138-h-flagged EmptyState action slot), onboarding's step CTAs,
 *      the thread send and the telegram-callback hang link all ride
 *      Button + buttonVariants (R116-S1); no flat bg-primary +
 *      shadow-primary/22 + h-12 stacks anywhere in the lane.
 *   2. quiet danger        — profile logout / unlink / logout-all rest
 *      muted with the status-error hover trio (the cart trigger's
 *      pinned register); severity lives in the useConfirm dialogs.
 *   3. calm active pill    — terms' tab row + the support category
 *      picker (tinted trio + boxed inactive, aria byte-identical).
 *   4. the thread pair     — customer = solid brand voice (NO bubble
 *      shadow), support = the muted/60 + /40 paper well.
 *   5. /60 resting edges   — one seam value across every section card,
 *      row and details shell in the lane.
 *   6. avatar calm well    — profile's identity tile on bg-muted/60 +
 *      /40 (no gradient, no shadow-inner bevel).
 *   7. ambient-wash        — onboarding's card carries login/register's
 *      exact atmosphere pair (the page's ONE r138 moment).
 *
 * The behavioral contracts (poll cadence, deep links, optimistic
 * mark-read, the R94-A1 double-submit guards) stay with the existing
 * render suites — this file pins only the chrome.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const PAGE = (rel: string) => read(`src/pages/${rel}`);
const SUPPORT = (rel: string) => read(`src/components/support/${rel}`);

/**
 * String-literal-aware comment stripper (the 139-c craft): the WHY
 * comments beside every retired class NAME those classes, so raw
 * absence checks would false-fire on the retirement's own
 * documentation. The scanner walks quotes before comment markers; no
 * `//` or `/*` sequence survives inside a string in this lane
 * (grep-verified — the only URLs live in comments).
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === "\\") {
          out += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `h-12` as a standalone class token — `min-h-12` must NOT match. */
const H_12_TOKEN = /(^|[\s"'`])h-12(?=[\s"'`])/;

const PROFILE = stripComments(PAGE("profile.tsx"));
const SESSIONS = stripComments(read("src/components/SessionManager.tsx"));
const NOTIFICATIONS = stripComments(PAGE("notifications.tsx"));
const SUPPORT_PAGE = stripComments(PAGE("support.tsx"));
const CREATE_FORM = stripComments(SUPPORT("CreateTicketForm.tsx"));
const THREAD = stripComments(SUPPORT("TicketThread.tsx"));
const TICKETS_LIST = stripComments(SUPPORT("TicketsList.tsx"));
const FAQ = stripComments(SUPPORT("FaqSection.tsx"));
const ONBOARDING = stripComments(PAGE("onboarding.tsx"));
const TERMS = stripComments(PAGE("terms.tsx"));
const TG_CALLBACK = stripComments(PAGE("telegram-callback.tsx"));
const AUTH_CALLBACK = stripComments(PAGE("auth-callback.tsx"));

describe("R139 recipe — canonical CTAs: buttonVariants owns the chrome, the engagement long tail stops hand-rolling", () => {
  it("support.tsx: the 138-h-flagged EmptyState action CTA + its three siblings carry no hand-rolled fill/shadow stacks", () => {
    // R139 (precision): four sites rode the identical hand-roll
    // (flat bg-primary + hover:bg-primary/90 + shadow-md
    // shadow-primary/22) — the EmptyState action slot 138-h flagged,
    // the header disclosure CTA, the anonymous login CTA and the
    // FetchErrorCard retryClassName override (now dropped entirely so
    // the card's r138 canonical default rides). Frozen file-wide:
    expect(SUPPORT_PAGE).not.toContain("shadow-primary/22");
    expect(SUPPORT_PAGE).not.toContain("bg-primary hover:bg-primary/90");
    // The retry override is GONE as a prop (the card default owns it).
    expect(SUPPORT_PAGE).not.toContain("retryClassName=");
  });

  it('onboarding.tsx: all three step CTAs ride size="lg" — no fixed h-12 geometry left in the page\'s code', () => {
    // R139 (precision): the wizard CTAs (التالي + تصفّح الكتالوج +
    // the outline twin) were w-full h-12 hand-rolls; size="lg" owns
    // the 48px + the variant recipe now. Count freezes the family —
    // a fourth CTA without the recipe fails it. (Plain counts, not a
    // tag regex: the onClick arrows terminate [^>]* early.)
    expect(ONBOARDING.match(/<Button\b/g)?.length ?? 0).toBe(3);
    expect(ONBOARDING.match(/size="lg"/g)?.length ?? 0).toBe(3);
    expect(ONBOARDING).not.toMatch(H_12_TOKEN);
    expect(ONBOARDING).not.toContain("shadow-lg shadow-primary/22");
  });

  it("CreateTicketForm: the submit pair + the raw fields converge on the shared recipes", () => {
    // R139 (precision): the submit drops the flat-primary stack but
    // KEEPS min-h-11 (the 44px storefront floor over the variant's
    // default); the title Input and the textarea join the shared
    // field register (A4-F12 ≥3:1 edge + the ONE focus ring).
    expect(CREATE_FORM).toContain('className="flex-1 min-h-11 gap-1.5"');
    expect(CREATE_FORM).not.toContain("shadow-md shadow-primary/22");
    expect(CREATE_FORM).not.toContain("focus:border-primary/40");
    expect(CREATE_FORM).toContain("border-muted-foreground/75");
    expect(CREATE_FORM).toContain("focus-visible:ring-2 focus-visible:ring-ring");
  });

  it('TicketThread: the send button is a Button size="icon" at the 44px floor — no raw <button> chrome left in the extract', () => {
    // R139 (precision): the composer's send was the lane's last raw
    // hand-rolled button; buttonVariants owns fill/elevation/press
    // while w-11 h-11 preserves the storefront floor + the h-11
    // reply-field pairing (the 96-F6 contract).
    expect(THREAD).toContain("<Button");
    expect(THREAD).toMatch(/size="icon"/);
    expect(THREAD).toContain('className="w-11 h-11"');
    expect(THREAD).not.toContain("active:scale-90");
    expect(THREAD).not.toContain("<button");
  });

  it('the two bridge pages speak ONE CTA register — Button asChild size="lg", no hand-rolled links', () => {
    // R139 (precision): auth-callback already carried the R116-S1
    // conversion; telegram-callback's hang link joined it this round.
    // The twins must not drift apart again.
    for (const [name, src] of [
      ["telegram-callback", TG_CALLBACK],
      ["auth-callback", AUTH_CALLBACK],
    ] as const) {
      expect(src, name).toMatch(/<Button asChild size="lg" className="mt-2">/);
      expect(src, name).not.toContain("shadow-primary/22");
      expect(src, name).not.toContain("bg-primary hover:bg-primary/90");
    }
  });
});

describe("R139 recipe — quiet danger at rest (severity lives in the confirm dialogs)", () => {
  it("profile: the logout trigger + the unlink rows rest muted, error ink ONLY on hover", () => {
    // R139 (precision): the cart clear-trigger's pinned register
    // (money-path-chrome-r139), applied to the account lane — muted
    // ink + border/60 + the status-error hover trio. The unlink rows
    // were already muted at rest; only the destructive hover channel
    // migrated.
    expect(PROFILE).toContain("border-border/60 text-muted-foreground hover:text-status-error");
    expect(PROFILE).toContain(
      "hover:text-status-error hover:bg-status-error/10 hover:border-status-error/30",
    );
    // No at-rest destructive ink/border anywhere on the page.
    expect(PROFILE).not.toMatch(/text-destructive(?![-\w])/);
    expect(PROFILE).not.toContain("border-destructive");
    expect(PROFILE).not.toContain("hover:text-destructive");
  });

  it("SessionManager: the logout-all twin speaks the same register at the 44px floor", () => {
    // R139 (precision): h-10 was the same sub-floor drift the profile
    // logout's own R124-I4 comment documents; the destructive trio
    // retires with the same stroke.
    expect(SESSIONS).toContain(
      "min-h-11 border-border/60 text-muted-foreground hover:text-status-error",
    );
    expect(SESSIONS).not.toMatch(/ h-10(?=[\s"'])/);
    expect(SESSIONS).not.toContain("border-destructive");
  });

  it("the severity half: the destructive confirms stay in the pages (useConfirm wiring byte-identical)", () => {
    expect(PROFILE).toContain("destructive: true");
    expect(SESSIONS).toContain("destructive: true");
  });
});

describe("R139 recipe — calm active pill on the lane's two tab/filter rows", () => {
  it("terms.tsx: the tab pair migrates off the raised-segment register onto the login twin", () => {
    // R139 (precision): active = the tinted trio + font-bold, inactive
    // = boxed-transparent + muted; the tray is the auth family's
    // bg-muted/30 + border/40 + rounded-2xl. Both states carry the
    // border box (1px toggle jitter dies). aria-pressed untouched.
    expect(TERMS).toContain("bg-muted/30 border border-border/40 rounded-2xl p-1");
    expect(TERMS).toContain('"bg-primary/15 text-primary-text border border-primary/30 font-bold"');
    expect(TERMS).toContain(
      '"border border-transparent text-muted-foreground font-semibold hover:text-foreground"',
    );
    expect(TERMS).toContain("aria-pressed={tab === id}");
    // The retired raised-segment vocabulary is gone file-wide.
    expect(TERMS).not.toContain("bg-card shadow-sm");
    expect(TERMS).not.toContain("bg-secondary/50");
  });

  it("CreateTicketForm: the category picker rides the tinted trio — no SOLID selected fill left in the lane", () => {
    // R139 (precision): the PDP VariantSelector dialect
    // (money-path-chrome-pinned) — bg-primary + text-white +
    // shadow-sm shadow-primary/20 dies on the selected pill.
    expect(CREATE_FORM).toContain('"bg-primary/15 text-primary-text border-primary/30"');
    expect(CREATE_FORM).toContain("aria-pressed={form.category === c.value}");
    expect(CREATE_FORM).not.toContain("bg-primary text-white");
    expect(CREATE_FORM).not.toContain("shadow-sm");
  });
});

describe("R139 recipe — the thread pair + the support chrome register", () => {
  it("TicketThread: customer bubble = solid brand voice with NO shadow; support bubble = the paper well", () => {
    // R139 (precision): the calm-pair treatment the admin
    // TicketDetailPane operator/customer twins canonized — no
    // elevation on a chat bubble, paper on bg-muted/60 + /40.
    // R157-IMPL-B #9: the customer bubble's ink rides the AA token
    // (text-primary-foreground) — the last raw text-white-on-fill pair
    // on the support lane (the avatar twin rode the same stroke).
    expect(THREAD).toContain('"bg-primary text-primary-foreground rounded-tl-md"');
    expect(THREAD).not.toContain("shadow-md shadow-primary/22");
    expect(THREAD).toContain('"bg-muted/60 border border-border/40 rounded-tr-md');
  });

  it("the thread shell + create card ride the /60 edge + the two-layer calm elevation", () => {
    // R139 (precision): the prominent-card register (CartSummaryAside
    // family) — brand borders and brand-tinted shadows retired.
    // R143 (L2-1): the calm elevation tokenized — shadow-calm
    // (index.css, theme-aware: dark byte-identical to the r138 literal,
    // .light re-tuned inside DESIGN.md's 6–14% ceiling); the arbitrary
    // literal must not come back on either component.
    expect(THREAD).toContain("border border-border/60");
    expect(THREAD).toContain("shadow-calm");
    expect(CREATE_FORM).toContain("border border-border/60");
    expect(CREATE_FORM).toContain("shadow-calm");
    expect(THREAD).not.toContain("0_10px_28px");
    expect(CREATE_FORM).not.toContain("0_10px_28px");
    expect(CREATE_FORM).not.toContain("border-primary/22");
    // The quiet band register on both banded headers.
    expect(THREAD).toContain("border-b border-border/60 bg-muted/30");
    expect(CREATE_FORM).toContain("border-b border-border/60 bg-muted/30");
    // The reply seam is the terminal receipt hairline.
    expect(THREAD).toContain('className="border-t border-border/20 p-4"');
  });

  it("TicketsList rows rhyme with their documented twin (orders' statusAccentBorder idiom)", () => {
    // R139 (precision): orders.tsx's comment names THIS ticket-card
    // idiom as the shared one — the twins now ride one register:
    // /60 edge, hover:border-border, the bare themed shadow-xl lift
    // (R157-C retired the raw-black color override on both twins).
    // The 3px status stripe + tints stay (the shared idiom).
    expect(TICKETS_LIST).toContain("bg-card border border-border/60 border-r-[3px]");
    expect(TICKETS_LIST).toContain("hover:border-border hover:shadow-xl hover:-translate-y-0.5");
    expect(TICKETS_LIST).not.toContain("shadow-black");
    expect(TICKETS_LIST).not.toContain("border-border/50");
    expect(TICKETS_LIST).not.toContain("shadow-lg shadow-black/12");
  });

  it("the FAQ accordion affordances are byte-identical — only the card edge moved", () => {
    // R139 (precision): native <details> semantics, marker
    // suppression and the group-open chevron rotator are the R137
    // verbatim-move contract; the pin freezes the affordance trio so
    // a future chrome pass can't quietly restructure them.
    expect(FAQ).toContain("border-border/60");
    expect(FAQ).toContain("[&_summary::-webkit-details-marker]:hidden");
    expect(FAQ).toContain("group-open:-rotate-90");
    expect(FAQ).not.toContain("border-border/55");
  });

  it("the no-messages tile joins the shared icon-stage family", () => {
    expect(THREAD).toContain("bg-muted/60 border border-border/35");
    expect(THREAD).toContain('className="w-5 h-5 opacity-35"');
    expect(THREAD).not.toContain("opacity-20");
  });

  it("support-meta: the closed status chip rides the neutral StatusBadge edge value", () => {
    // R139 (precision): the taxonomy's one non-token edge (full
    // border-border) joins the canonical neutral tone
    // (bg-muted/45 + border-border/50) the admin StatusBadge pins —
    // open/in_progress stay on --status-* tints byte-identical.
    const meta = stripComments(SUPPORT("support-meta.tsx"));
    expect(meta).toContain('border: "border-border/50"');
    expect(meta).toContain('color: "text-status-info bg-status-info/10"');
    expect(meta).toContain('color: "text-status-warning bg-status-warning/10"');
    expect(meta).not.toMatch(/border: "border-border"/);
  });
});

describe("R139 recipe — notifications: seams /60, hover calm, unread indicator on tokens", () => {
  it("the row register: read seams /60 + the calm border-step hover; unread edge /30 + tint", () => {
    // R139 (precision): hover = the border step ONLY (cart's line-row
    // idiom — no elevation); the unread TINT + 1px token stripe +
    // pulsing dot are the bell's own language, byte-identical.
    expect(NOTIFICATIONS).toContain('"border-border/60 hover:border-border"');
    expect(NOTIFICATIONS).toContain(
      '"border-primary/30 bg-primary/[0.03] hover:border-primary/50"',
    );
    expect(NOTIFICATIONS).toContain("w-px bg-primary/60 rounded-full");
    expect(NOTIFICATIONS).not.toContain("border-border/50");
  });

  it("the count chip carries no elevation; the skeleton mirrors the loaded row frame", () => {
    expect(NOTIFICATIONS).not.toContain("shadow-sm");
    expect(NOTIFICATIONS).toContain('className="h-20 rounded-2xl border border-border/60"');
    expect(SUPPORT_PAGE).toContain('className="h-24 rounded-2xl border border-border/60"');
  });

  it("the mark-all CTA rides the shared Button; the per-row twin rhymes with the bell byte-identically", () => {
    // R139 (precision): markAllRead = Button ghost + min-h-11 (the
    // canonical tertiary register); the per-row «تحديد كمقروء» keeps
    // the bell's own class string — the page's "same surface as the
    // panel" contract (NotificationBell.tsx is layout-owned).
    expect(NOTIFICATIONS).toMatch(/<Button[^>]*variant="ghost"/);
    expect(NOTIFICATIONS).toContain(
      '"flex min-h-11 items-center gap-1 text-2xs text-muted-foreground hover:text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/40 transition-all duration-150"',
    );
  });
});

describe("R139 recipe — profile: /60 section cards, the avatar calm well, the prominent-card elevation", () => {
  it("every section card rests on the family edge", () => {
    expect(PROFILE).not.toContain("border-border/55");
    expect(SESSIONS).not.toContain("border-border/55");
  });

  it("the avatar joins the well family — no gradient, no inset bevel", () => {
    // R139 (precision): from-primary/25→primary/8 + shadow-inner were
    // the pre-r138 skeuomorph stack; the tier gradient + badge carry
    // the card's color identity now.
    expect(PROFILE).toContain(
      '"w-14 h-14 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center shrink-0"',
    );
    expect(PROFILE).not.toContain("from-primary/25");
    expect(PROFILE).not.toContain("shadow-inner");
  });

  it("the identity card carries the two-layer calm elevation (the page's one prominent card)", () => {
    expect(PROFILE).toContain("shadow-calm");
    expect(PROFILE).not.toContain("shadow-lg shadow-black/8");
  });

  it("SessionManager: the current-session tint + the «الحالي» chip ride the family values", () => {
    // R139 (precision): the tinted-selected pair (border-primary/30 +
    // bg-primary/8) + the one static-badge edge value (/30).
    expect(SESSIONS).toContain('"border-primary/30 bg-primary/8"');
    expect(SESSIONS).toContain("bg-primary/15 text-primary-text border border-primary/30");
    expect(SESSIONS).not.toContain('"border-primary/25 bg-primary/5"');
  });
});

describe("R139 recipe — onboarding: the auth-family atmosphere pair + byte-identical progression dots", () => {
  it("the welcome card carries login/register's exact layer pair", () => {
    // R139 (precision): the page's own docblock says "match the auth
    // pages" — the wash + hairline pair IS that family's r138
    // atmosphere moment; the page-level blob layers stay (login/
    // register kept theirs). One moment per page.
    expect(ONBOARDING).toContain("ambient-wash");
    expect(ONBOARDING).toContain("hairline-glow");
    expect(ONBOARDING).not.toContain("shadow-black/20");
  });

  it("the step progression indicators are the sanctioned vocabulary, untouched", () => {
    // R139 (precision): the mission pinned these byte-identical —
    // w-8 active / w-4 inactive on bg-primary vs bg-muted/60.
    expect(ONBOARDING).toContain('"w-8 bg-primary"');
    expect(ONBOARDING).toContain('"w-4 bg-muted/60"');
  });
});

describe("R139 recipe — terms: typography-forward, one edge family, the pinned breadcrumb untouched", () => {
  it("the reading card rests on /60; the stamp rules are the receipt hairline", () => {
    expect(TERMS).toContain('className="bg-card border border-border/60 rounded-2xl p-6 md:p-8"');
    expect(TERMS).not.toMatch(/border-t border-border\/(?!20)\d+/);
  });

  it("the forward chevron separator family is intact (terms-legal-page pins the render side)", () => {
    // R139 (precision): the breadcrumb separators are the pinned
    // unrotated ChevronLeft family — source-side, the glyph still
    // rides opacity-50 with NO rotation class.
    expect(TERMS).toContain('<ChevronLeft className="w-3 h-3 opacity-50" />');
    expect(TERMS).not.toContain("rotate-180");
  });
});
