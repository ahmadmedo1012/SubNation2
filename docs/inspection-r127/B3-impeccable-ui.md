# R127-B3 — Impeccable UI Anti-Pattern Audit (live URL + local source)

**Agent:** R127-B3 (read-only auditor) · **Tool:** `impeccable` v4.1.0 (pbakaus/impeccable, Apache-2.0) — `detect` engine (Rust sidecar binary, no LLM, no API key)
**Targets:** https://subnation.ly (11 URL targets ×2 viewports) + `frontend/src/` (regex mode) · **Repo:** f53a886 (= production)
**Method:** URL scans via Puppeteer rendering (Playwright's Chromium 124 via `IMPECCABLE_BROWSER`), JSON + text outputs captured under `/tmp/b3-impeccable/`; every kept finding re-verified with independent Playwright DOM/geometry probes (7 probe scripts); waived families mapped to source with computed-style evidence.
**Safety:** zero source mutations, zero commits, guest-level GETs only. `git status` clean (only this report's directory is new). Prior coverage read first: `docs/inspection-r126/A13-real-browser-a11y.md` (F1–F12) + `A9-storefront-ux.md` (F1–F6, OPS-1/2) + worklog tail — no re-reports below.

---

## 1. Raw detector output (counts; full JSON/text live in /tmp/b3-impeccable/)

| Scan | Target(s) | Findings | primary (warning) | advisory | Exit |
|---|---|---|---|---|---|
| URL desktop | `/` @1280×800 | **169** | 123 | 46 | 2 |
| URL mobile | `/` @390×844 | **214** | 169 | 45 | 2 |
| URL desktop | `/product/lifetime-cloud-storage`, `/cart`, `/login`, `/flash-sales`, `/category/software` | **14** | 14 | 0 | 2 |
| URL desktop | `/register`, `/support`, `/terms`, `/status` | **10** | 10 | 0 | 2 |
| **Local source** | `frontend/src/` (regex mode) | **5** | 5 | 0 | 2 |
| **Total** | 11 URLs + src | **412** | **321** | **91** | — |

Rule families hit (13 distinct), collapsed across all scans:

| Rule | Sev | Class | Total hits | Unique source sites |
|---|---|---|---|---|
| bounce-easing | warning | slop | 54 live (3 curves) + 5 src | 5 (index.css) |
| ai-color-palette | warning | slop | 46 | 1 system (ProductCard accents) |
| image-hover-transform | advisory | slop | 45 | 2 (ProductCard) |
| low-contrast | warning | quality | 37 (26 median-pass) | 3 pages + 3 components |
| nested-cards | warning | slop | 44 (mobile only) | 1 (ProductCard) |
| dark-glow | warning | slop | 7 | 5 components |
| text-overflow | warning | quality | 4 → **16 real** (my census) | 1 (ProductCard) |
| clipped-overflow-container | warning | quality | 3 | 3 sites |
| heading-rhythm | warning | quality | 2 (mobile) | 1 (ProductCard) |
| layout-transition | warning | quality | 5 pages | 0 (third-party) |
| cramped-padding | warning | quality | 1 | 1 (Button) |
| radial-spotlight-glow | warning | slop | 1 | 1 (.dot-grid) |
| em-dash-overuse | advisory | slop | 1 | copy convention |

**URL-mode limitations (honest):** one URL per target arg (multi-target works, as used); needs a Chromium-family browser (the npx shim downloads a 16 MB engine binary on first run — offline CI needs a pre-provisioned browser + `IMPECCABLE_BROWSER`); URL mode measures the *rendered* page (computed styles, pixel-sampled contrast, geometry) which source mode cannot, and source mode is regex-only (it found only the 5 literal cubic-beziers). Auth-gated surfaces (admin, checkout, wallet, orders) were not scanned — guest-level only, matching the A13 ground rules.

---

## 2. Triage — kept vs waived (with reason)

### KEPT (2 findings, mapped + re-verified)

| ID | Rule | Sev | Conf | One-liner |
|---|---|---|---|---|
| B3-K1 | text-overflow | **P2** | 5 | Mobile product-card titles hard-clip mid-glyph: the `shrink-0` category badge eats the title row |
| B3-K2 | low-contrast | P3 | 3 | Muted micro-text (11px / fine print) samples at 3.2–4.1:1 pixel-median despite 8:1 token math |

### WAIVED (11 rule families, 409 hits — each with evidence + reason)

| Rule (hits) | Detector saw | Maps to | Waiver reason |
|---|---|---|---|
| bounce-easing (54+5) | `cubic-bezier(0.34, 1.35…1.6, 0.64, 1)` on card entrances, hover springs, tab slide | `index.css:686` (.float-in), `:784` (.card-spring), `:798` (.press-spring), `:818` (.num-pop), `:828` (.tab-slide-in) | **Brand motion system.** `docs/ux/FINAL_UX_SYSTEM.md` §2 sanctions exactly this vocabulary ("press-spring, one-shot entrances page-in/float-in/slide-up… every animation answers why"). Overshoot values are mild (1.35–1.6), all covered by the global reduced-motion kill-switch (A13 J6 PASS). Detector's exponential-easing advice is a taste position, not a defect. |
| ai-color-palette (46) | 19 purple/violet gradient bgs + 19 violet "neon" texts + 4 cyan each | `ProductCard.tsx:77-150` (ACCENTS) + `index.css:144-152/292-300` (9 `--cat-*` hues, dark+light ramp pairs) | **Category coding system, not reflex purple.** DOM census: the 19 violet hits are the 17 ai-tools cards (HSL 291° → oklab hue 305°) + 2 seo cards; the 4 cyan are VPN cards; gradients are 12%/4%-opacity tints, badges use tinted `bg-cat-*/10` + `text-cat-*`. A deliberate, documented 9-hue system. *Honest note:* 270–291° are precisely the hues the rule exists for — if the palette is ever retuned, shifting `--cat-ai-tools`/`--cat-streaming` is the single lever that clears ~27% of homepage detector noise. |
| dark-glow (7) | `#dc1840` colored box-shadow glow on dark ×7 | `ui/button.tsx:14` (primary variant), `layout/Logo.tsx:25,27`, `ProductCard.tsx:343` (discount badge /40), `:627` (quick-add /30), `home.tsx` hero CTA + `:1088` | **Brand accent lighting.** All 7 are the #dc1840 primary at 20–40% alpha on interactive elements. The project already polices this itself: R124-A3 #6 deleted the zero-offset `.cta-glow` halo ("a zero-offset colored halo is decoration", index.css:805-809) and sonner.tsx:14 documents removing colored glow from toasts. Strongest remaining candidate if ever de-slopping: `shadow-primary/40` on the card discount badge. |
| radial-spotlight-glow (1) | radial-gradient `#a0abba` 0.06→transparent on 1118×456 hero surface | `index.css:757-763` (`.dot-grid`) used `home.tsx:665`, `register.tsx:67`, `login.tsx:91`, `profile.tsx:245`, `onboarding.tsx:104`, `wallet.tsx:1233` | **Technique misread (false positive).** The radial-gradient draws 1px dots on a 22px tile (`circle, hsl(var(--muted-foreground)/0.055) 1px, transparent 1px`) — a dot texture, not a spotlight halo. The rule's "soft radial fading to transparent" heuristic can't distinguish the dot-drawing idiom. |
| cramped-padding (1) | 0px vertical padding, 16px text | `ui/button.tsx:37` (`size lg: h-12 px-8 text-base`) via hero CTA `home.tsx:837` | **Fixed-height flex button.** Text is vertically centered in a 48px flex container; the rule models padding-boxed text flush against an edge, which doesn't apply. A13 J4 measured the same button 44px+ tap-target PASS. |
| clipped-overflow-container (3) | `overflow-hidden` containers wrapping positioned children | `ProductCard.tsx:321` root (children :343/:351/:370/:380/:382/:430/:627/:643), `home.tsx:662`, `home.tsx:775` | **Intentional containment.** Every positioned child is decorative/inset (badges at 10px inset, accent line, gradients, shine sweep) or intentionally enters from outside (the `translate-y-full` hover CTA, :643, slides *into* the clip). No tooltip/popover/menu lives inside these containers — the failure mode the rule guards against doesn't exist here. |
| nested-cards (44, mobile only) | "Card inside card" per product card | `ProductCard.tsx` internals: category/variant badges (:470-477, :517-540), icon tile (:433) | **Heuristic over-trigger on e-commerce card anatomy.** DOM probing found no nested card *surfaces* (no outer wrapper card): the "inner cards" are 20–43px chips/badges and the CTA button inside a card — standard media+body card anatomy. 0 hits on the identical desktop DOM confirms the size-band heuristic, not real depth nesting. Weakest signal for this project → belongs in URL-scan ignores. |
| image-hover-transform (45, advisory) | Tailwind `group-hover:scale-[1.06]` / `scale-105` on `<img>` | `ProductCard.tsx:418`, `:433` | **Deliberate e-commerce affordance** (product-media hover zoom is a store convention, not an AI tell) + advisory severity — never blocks anyway. |
| em-dash-overuse (1, advisory) | 18 em-dashes in body text | Arabic copy convention (e.g. product descriptions «رخصة cPanel للخوادم — VPS أو…») | **Arabic typography + advisory.** The em-dash clause separator is the norm in modern Arabic web copy; A8 (R126 Arabic-copy audit) passed these strings. Rule is English-typography-centric. |
| layout-transition (5 pages) | `transition: height` | `[data-sonner-toast] { transform, opacity, height, box-shadow 0.4s… }` — **sonner's own injected stylesheet**, present on every route via the global Toaster | **Third-party lifecycle animation**, not SubNation source (0 matches for height transitions in `frontend/src`). Toasts are transient; the height transition is sonner's documented collapse. Would need a URL-scope ignore so it can't block. |
| low-contrast — median-passing subset (26 of 37) | pixel 1.2–1.7:1 but **median 5.3–10.6:1** (passes 4.5:1) on nav «الكتالوج» (backdrop-filter header, 7 pages) and 14px bold card titles | Navbar.tsx nav link; `ProductCard.tsx:464-469` | **Already measured passing by our own real-browser audit.** A13 J7 measured 437/437 computed-style text nodes passing on `/` (alpha-composited); these same nodes pass at median here too — the sub-2:1 *pixel-min* is anti-alias edge ink, which WCAG's methodology does not measure. Waived per the "dark-theme contrast already measured with real browsers" rule. |

**Borderline, noted not filed:** heading-rhythm (2 hits, mobile) — «Grammarly Pro» 12px-above vs 28px-below, «cPanel» 12/48. Cause: the title row's `pt-3` gives 12px above (to the media block) while `mt-auto` on the price row stretches the below-gap to the card foot. The rule's document-flow model (heading binds to content *below*) inverts inside a card where the title + image above are one visual unit. Waived as card-anatomy; if the team ever tightens card interiors, capping the `mt-auto` stretch would clear it for free.

---

## 3. Kept findings — full evidence

### B3-K1 [P2 · confidence 5] Mobile product-card titles hard-clip mid-glyph — the shrink-0 category badge starves the title row

- **Detector evidence:** `text-overflow` ×4 on mobile home — `h3.font-bold.text-sm.leading-snug.line-clamp-2.sm:line-clamp-1.flex-1.min-w-0.text-foreground/85…` (ProductCard title).
- **Independent verification (stronger than the detector's):** at 390px, **16 of 45** grid titles overflow their own box (`scrollWidth 46–79px` vs `clientWidth 20–50px`); per-glyph Range rects prove ink renders **beyond the clip box** (e.g. "Lifetime Cloud Storage": lines 60px and 55px wide inside a 45px box; `overflow-x: hidden` from `line-clamp-2` then cuts the words mid-glyph). Worst case: "Shopia AI" — title box **20px** wide («أدوات ذكاء اصطناعي» badge = 112px of the 143px row).
- **Root cause:** `ProductCard.tsx:456-477` — title row `flex items-start gap-2` puts `h3.flex-1.min-w-0` next to a `shrink-0` category badge whose Arabic label runs 82–112px («برامج وتراخيص» 90px, «تعليم ومكتبات» 82px, «أدوات ذكاء اصطناعي» 112px) inside a 143px row on the 2-col mobile grid. R124-A4-F7's `min-w-0` deliberately made the *title* the flex sacrifice to protect the badge — the detector proves the squeeze now lands on the names: long unbreakable Latin tokens ("Grammarly" 78px, "Windows" 65px, "Skillshare" 69px) cannot wrap and clip. Desktop: 0/45 overflow (badge shares a 289px row comfortably).
- **Why it matters:** mobile-majority market (A9's own framing); the product name is the card's primary identifier; 16/45 = 36% of the live catalog grid shows clipped or half-clipped names at 390px (worse at 360px Android widths). Not page-level horizontal scroll — A13 J4's leak check (0px) couldn't see intra-box clipping, and A9's mobile spot-audit checked overflow at page scope. **NEW — no prior coverage.**
- **Fix (S):** on `<sm` move the badge to its own row under the title (the row already has `mb-1.5` to absorb it), or cap it (`max-w-[72px] truncate` / short mobile labels). Pin with the A4-F7-style regression note. (Evidence artifact: `/tmp/b3-impeccable/clipped-title-card.png`.)

### B3-K2 [P3 · confidence 3] Muted micro-text renders at 3.2–4.1:1 pixel-median despite 8:1 token math (anti-alias density at 11px / fine print)

- **Detector evidence:** `low-contrast` with **failing medians** — 11 instances across 4 pages: home (desktop; the 11px description row is `hidden sm:block`, so this bucket is ≥640px-only) «رخصة cPanel…» 3.3:1, «مفتاح Windows 8…» 3.3:1, «مفتاح Windows 10 Home…» 3.3:1, «رخصة WinRAR…» 3.3:1, «Grammarly Pro — تصحيح لغوي…» 3.6:1; `/category/software` «تخزين سحابي مدى الحياة…» 3.2:1 + the cPanel/Grammarly descriptions again; `/register` «بإنشاء حسابك فإنك توافق على…» 3.5:1 + «لديك حساب بالفعل؟» 4.1:1; `/support` «سجّل الدخول لفتح تذكرة دعم ومتابعة الرد…» 3.5:1 (the register/support fine print is visible on mobile too).
- **Maps to:** `ProductCard.tsx:482` (`hidden sm:block text-muted-foreground text-2xs line-clamp-2` → 11px/400) + `index.css:107` (`--text-2xs: 11px`); `register.tsx:195,211`; `support.tsx:797`.
- **Mechanism (why token math and pixels disagree):** muted-foreground `rgb(160,171,186)` on card `rgb(16,19,24)` is **8.0:1** by WCAG math — A13 J7 correctly passed these exact nodes with computed-style measurement. The pixel sampler instead measures *rendered ink*: at 11px/400, Arabic/Latin hairline strokes are mostly blended edge pixels (≈50% fg/bg ≈ 4.5:1 ceiling), so the median sample lands 3.2–3.6:1. Corroboration: the same rule samples the 14px **bold** titles on identical backgrounds at 8.8–10.6:1 median — font-size/weight is the only variable.
- **Honest framing:** NOT a WCAG violation (spec methodology passes it; A13 verified) — a rendering-density risk on the smallest, lowest-priority text. Kept because it is rule-grounded, measurable, and cheap to improve. **NEW** — distinct elements from A13 F12 (sale-price badge, 12px bold, 3.76:1 *token* failure, still open); the detector notably did *not* re-flag A13 F12's badge.
- **Fix (S):** card descriptions → `text-xs` (12px) + `font-medium`, or keep 11px and lift to `text-muted-foreground/90`; same treatment for the two authed-note lines. Note `--text-3xs` was already raised to 11px in R123 (index.css:108) — this is the same family of concern, next size up.

---

## 4. Cross-check against held-open items (A13 / A9)

| Prior item | Relation to this audit |
|---|---|
| A13 F2 (drawer Esc/dialog semantics), F11 (safe-area insets), F1, F4–F12 | Not re-detected by impeccable (no focus/dialog/viewport rules in its set) — still open, untouched here. Only overlap: A13 F12's sale badge was **not** re-flagged by the pixel sampler; A13 F9's heading *skips* on /flash-sales + /cart were also not re-detected (impeccable's skipped-heading rule didn't fire on those DOMs). |
| A9 F1–F6, OPS-1/2 | No overlap with detector rules (journey/continuation items). OPS-1's live «تجربة» flash sale does amplify K1's badge squeeze context but is operator-owned. |
| **Net new:** B3-K1 (P2), B3-K2 (P3) | Neither appears in any R124–R126 register. |

---

## 5. Detector fitness for THIS project (Arabic RTL + dark + e-commerce)

**Where it does well (adopt):** rendered-geometry quality rules — text-overflow (found a real P2 our audits missed), cramped/clipped containers, heading rhythm; pixel-sampled contrast over non-trivial backgrounds (backdrop-filter, opacity stacks) — complementary to A13's computed-style method, not redundant; code-literal slop tells in source mode (purple/cyan gradients, bounce curves, glow shadows, em-dash copy) as a *review radar*.
**Where it's weak for us (scope the gate):** no RTL-specific rules at all (it never inspects direction, Arabic typography, bidi, or logical-property flips — everything it caught here was direction-agnostic geometry); card/e-commerce heuristics misfire (nested-cards ×44 on standard card anatomy; radial-spotlight misreads the dot-grid technique; cramped-padding misreads fixed-height flex buttons); URL mode picks up third-party CSS (sonner's height transition) and needs a browser + engine download in CI. Waived-with-reason is a *first-class mechanism* here (config `ignoreRules`/`ignoreFiles`/`ignoreValues` + inline `impeccable-disable*` comments) — use it rather than fighting the heuristics.

---

## 6. CI-gate adoption plan (honest, phased)

**Config — `frontend/.impeccable/config.json`** (new file; detector auto-loads it):

```json
{
  "$schema": "https://impeccable.style/schema/v4/detector.json",
  "detector": {
    "ignoreFiles": ["**/node_modules/**", "src/test/**"],
    "ignoreValues": [],
    "ignoreRules": []
  }
}
```

Source-mode needs **no rule ignores** once the 5 bounce-easing sites carry inline waivers (intent documented at the site, travels with the file):

```css
/* index.css:686 */
.float-in {
  /* impeccable-disable-line bounce-easing: sanctioned spring vocabulary (FINAL_UX_SYSTEM §2) */
  animation: float-in 0.34s cubic-bezier(0.34, 1.35, 0.64, 1) both;
}
```
(same one-liner at :784, :798, :818, :828 — after which `detect src/` exits 0.)

**Phase 1 — source gate (add now; deterministic, no browser, ~2s):**

```jsonc
// frontend/package.json scripts
"lint:ui": "impeccable detect src/"
```
```yaml
# .github/workflows/ci.yml — new job after lint/typecheck, path-gated on frontend/src/** + the config
ui-antipatterns:
  name: UI anti-patterns (impeccable)
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@… # existing SHA pin
    - run: npx -y impeccable@4.1.0 detect frontend/src/
```
- **Exit semantics:** `0` pass · `2` findings → **fail the job** · `1` operational (scan couldn't run) → fail *hard* (never `|| true`; a masked 1 silently turns the gate off). Only `warning`-severity findings affect exit code; advisories (image-hover-transform, em-dash) print but never block — matches the tool's own semantics, no extra filter needed in source mode.
- **Pin the version** (`impeccable@4.1.0`): the npx shim downloads a version-locked engine binary; unpinned = rule-set drift between runs. Optionally cache `~/.impeccable/bin/`.

**Phase 2 — rendered gate (nightly `schedule:` or post-deploy, NOT per-push):** scan the live site (or `vite preview` of the build) — desktop + 390×844 — with a waived-rules filter, because 409 of 412 raw hits are waived brand/system items that would permanently exit 2:

```bash
IMPECCABLE_BROWSER="$CHROME_PATH" npx -y impeccable@4.1.0 detect \
  https://subnation.ly https://subnation.ly/category/software https://subnation.ly/product/lifetime-cloud-storage \
  https://subnation.ly/cart https://subnation.ly/login https://subnation.ly/register https://subnation.ly/flash-sales \
  https://subnation.ly/support https://subnation.ly/terms https://subnation.ly/status \
  --viewport 390x844 --json > /tmp/ui.json
jq '[.[] | select(.severity == "warning")
       | select(.antipattern as $r | ["bounce-easing","ai-color-palette","dark-glow","radial-spotlight-glow",
            "cramped-padding","clipped-overflow-container","nested-cards","heading-rhythm","layout-transition",
            "image-hover-transform","em-dash-overuse"] | index($r) | not)] | length' /tmp/ui.json
# fail if > 0 — i.e., block only on rules outside the waived set (low-contrast median-failing, text-overflow, etc.)
```
This is a **new-rule tripwire**: any rule family not on the waiver list (i.e., anything the triage above didn't bless) blocks — exactly how B3-K1 was caught. Pre-req: fix B3-K1 first, or the nightly blocks on day one (that is the point).
- The waiver list lives in one place (the workflow) — keep it in sync with this report's triage table; each entry carries its reason above. `low-contrast` stays *out* of the ignore list deliberately: only its median-passing instances are waived, and the filter above can't tell them apart — refine to `select(.snippet | contains("median 1")` …) is fragile; instead exclude `low-contrast` hits whose snippet contains `median ` value ≥ 4.5 — or accept manual triage of the ~19 known-benign hits per run (recommended: start strict, loosen with a JSON snippet filter once the noise is understood).

**Phase 3 (optional, later):** author `DESIGN.md` from `docs/ux/FINAL_UX_SYSTEM.md` (Readex Pro, #dc1840 + primary-text, the 9 cat hues, radius scale, type ramp). With a design system present, impeccable activates `font/color/radius/font-size-outside-design-system` drift rules — turning the detector into a token-drift guard too. Expect a tuning pass (Tailwind arbitrary values will fire) before it can gate.

**Do NOT adopt:** per-push URL scans (browser + engine download + third-party CSS noise + production coupling); gating on advisory severity; running with `--no-config` (loses ignore hygiene).

---

## 7. Verdict

The storefront holds up well under a hostile design-slop detector: **409 of 412 raw hits waive cleanly** on brand-system, RTL/dark-context, or demonstrated-false-positive grounds — and the waivers are the *documented* kind (FINAL_UX_SYSTEM tokens, self-policed glow deletions, A13's measured contrast). What survives triage is one genuinely valuable catch and one honest risk note: **B3-K1 (P2, clipped mobile titles — fix before the next release)** and **B3-K2 (P3, 11px muted text renders softer than its tokens claim)**. The detector earns a scoped place in CI: source-mode gate now (5 inline waivers → exit 0), nightly rendered tripwire after K1 lands, DESIGN.md drift rules as a follow-up. Its RTL coverage is zero — it must ride *alongside* the A13-style real-browser audits, never instead of them.

**P0: 0 · P1: 0 · P2: 1 · P3: 1** (+1 borderline waived: heading-rhythm; 11 waived rule families documented above)
