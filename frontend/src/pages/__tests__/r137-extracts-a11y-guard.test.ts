/**
 * R137 (3-c) — the icon-only-button labeling guard.
 *
 * The r137 admin decomposition wave landed ~160 extract files under
 * components/admin/{system,orders,products,topups,users,layout,pricing,
 * dashboard,coupons,alerts,admins,security,tickets}/ plus
 * components/{support,loyalty}/ and src/app/. Verbatim moves preserved
 * the batch-1..15 a11y wins, and this pass (3-c) closed the LAST two
 * icon-only gaps (the dashboard CSV-export pair — both mirrored their
 * existing `title`): every icon-only button in the extract surface now
 * carries an accessible name.
 *
 * THE DISCIPLINE (source-scan, the r128-sweep / r136-contract idiom —
 * a render suite only covers the buttons it happens to click):
 *
 *   1. walk every `<button` / `<Button` open-close span in the r137
 *      extract dirs (a real tokenizer: ' " ` strings with ${} nesting,
 *      line and block comments inside expression attributes, brace
 *      depth — NOT a flat regex, because this repo's buttons carry
 *      arrow-function onClick bodies with English prose comments);
 *   2. a button is ICON-ONLY when its entire element content is ONE
 *      lucide icon component (from that file's lucide-react import)
 *      with no other element, text or expression;
 *   3. every icon-only button MUST carry aria-label / aria-labelledby
 *      (or sr-only text) — an unnamed icon button is the WCAG 4.1.2
 *      "button, no name" failure the storefront navbar hamburger and
 *      the admin top-bar already fixed in R125 (A6 B-11);
 *   4. `title` alone is NOT enough (title is hover-only — no touch,
 *      no AT name on most SR/browser pairs) — which is exactly why
 *      the 3-c fix mirrors the title text into aria-label instead of
 *      counting the title as a label.
 *
 * Buttons whose content is icon + (possibly hidden) text, icons inside
 * conditional expressions, or Button-asChild wrappers are NOT flagged
 * by rule 2's strict single-icon test — that is deliberate (the
 * guardrail: ambiguous content is left alone, never auto-"fixed").
 * They stay covered by the spot-pins below where they matter.
 *
 * Decorative icons need NO pass here: lucide-react v0.545 (pinned in
 * the lockfile) renders every icon `<svg aria-hidden="true">` by
 * default (dist/esm/Icon.js — `...!children && !hasA11yProp(rest) &&
 * { "aria-hidden": "true" }`), so standalone icons are already removed
 * from the accessibility tree unless an author deliberately passes an
 * a11y prop. Zero hand-rolled aria-hidden churn was needed (3-c audit
 * finding — see the worklog entry).
 */
import { readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The r137 extract surface (mission 3-c scope) — 16 dirs under src/. */
const EXTRACT_DIRS: string[] = [
  "src/components/admin/system",
  "src/components/admin/orders",
  "src/components/admin/products",
  "src/components/admin/topups",
  "src/components/admin/users",
  "src/components/admin/layout",
  "src/components/admin/pricing",
  "src/components/admin/dashboard",
  "src/components/admin/coupons",
  "src/components/admin/alerts",
  "src/components/admin/admins",
  "src/components/admin/security",
  "src/components/admin/tickets",
  "src/components/support",
  "src/components/loyalty",
  "src/app",
];

function walkFiles(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir moved/renamed — the inventory floor below fails loudly
  }
  for (const e of entries) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
}

const extractFiles: string[] = [];
for (const d of EXTRACT_DIRS) walkFiles(resolve(process.cwd(), d), extractFiles);

/** Lucide component names imported per file (no aliases in this surface). */
function lucideNamesOf(src: string): Set<string> {
  const names = new Set<string>();
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/);
  if (m) {
    for (const part of m[1].split(",")) {
      const n = part.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split("\n").length;
}

/**
 * Find the `>` that closes an opening tag, skipping strings (with ${}
 * nesting), // and block comments, and {} expression depth — arrow
 * attributes (`onClick={() => …}`) and commented attrs are routine in
 * this surface. Returns -1 on malformed input (caller skips the span).
 */
function findOpenTagEnd(src: string, i: number): number {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    const nx = src[i + 1];
    if (c === "/" && nx === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && nx === "*") {
      const end = src.indexOf("*/", i);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      let t = 0;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`" && t === 0) {
          i++;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          t++;
          i += 2;
          continue;
        }
        if (src[i] === "}" && t > 0) {
          t--;
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      continue;
    }
    if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

interface ElementSpan {
  tag: string;
  openTag: string;
  inner: string;
  line: number;
}

function findElementSpans(src: string, tagNames: string[]): ElementSpan[] {
  const spans: ElementSpan[] = [];
  const openRe = new RegExp(`<(${tagNames.join("|")})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(src)) !== null) {
    const tag = m[1];
    const start = m.index;
    const end = findOpenTagEnd(src, start + m[0].length);
    if (end === -1) continue;
    const openTag = src.slice(start, end + 1);
    if (openTag.endsWith("/>")) {
      spans.push({ tag, openTag, inner: "", line: lineOf(src, start) });
      continue;
    }
    // walk to the matching close tag, honoring nested same-tag elements
    let depth = 1;
    let closeIdx = -1;
    const tagRe = new RegExp(`<(/?)${tag}(?=[\\s/>])`, "g");
    tagRe.lastIndex = end + 1;
    let nm: RegExpExecArray | null;
    while ((nm = tagRe.exec(src)) !== null) {
      if (nm[1] === "/") {
        depth--;
        if (depth === 0) {
          closeIdx = nm.index;
          break;
        }
      } else {
        const ne = findOpenTagEnd(src, nm.index + nm[0].length);
        if (ne !== -1 && src.slice(nm.index, ne + 1).endsWith("/>")) continue;
        depth++;
      }
    }
    if (closeIdx === -1) continue;
    spans.push({
      tag,
      openTag,
      inner: src.slice(end + 1, closeIdx),
      line: lineOf(src, start),
    });
  }
  return spans;
}

function stripJsxComments(s: string): string {
  return s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

interface IconOnlyButton {
  file: string;
  line: number;
  icon: string;
  hasLabel: boolean;
  hasSrOnly: boolean;
}

/** An icon-only button's whole content is ONE lucide element — no text,
 *  no sibling element, no expression (the strict, unambiguous case). */
const SINGLE_LUCIDE_RE = /^<([A-Z][A-Za-z0-9]*)\b[\s\S]*?(?:\/>|>\s*<\/([A-Z][A-Za-z0-9]*)\s*>)$/;

function collectIconOnlyButtons(): IconOnlyButton[] {
  const found: IconOnlyButton[] = [];
  for (const f of extractFiles) {
    const src = read(f);
    const lucide = lucideNamesOf(src);
    if (lucide.size === 0) continue;
    const rel = f.slice(resolve(process.cwd()).length + 1);
    for (const span of findElementSpans(src, ["button", "Button"])) {
      const inner = stripJsxComments(span.inner);
      if (!inner) continue; // empty button — ambiguous, out of scope here
      const sm = inner.match(SINGLE_LUCIDE_RE);
      if (!sm || !lucide.has(sm[1])) continue;
      found.push({
        file: rel,
        line: span.line,
        icon: sm[1],
        hasLabel: /aria-label\s*=/.test(span.openTag) || /aria-labelledby\s*=/.test(span.openTag),
        hasSrOnly: /sr-only/.test(span.inner),
      });
    }
  }
  return found;
}

/** Button asChild renders its child (Link/a/…) as the interactive element —
 *  an icon-only child needs the name on the child or the Button. */
function collectAsChildIconOnly(): IconOnlyButton[] {
  const found: IconOnlyButton[] = [];
  for (const f of extractFiles) {
    const src = read(f);
    const lucide = lucideNamesOf(src);
    if (lucide.size === 0) continue;
    const rel = f.slice(resolve(process.cwd()).length + 1);
    for (const span of findElementSpans(src, ["Button"])) {
      if (!/asChild/.test(span.openTag)) continue;
      const inner = stripJsxComments(span.inner);
      const cm = inner.match(/^<([A-Za-z][A-Za-z0-9]*)\b/);
      if (!cm) continue;
      const child = findElementSpans(inner, [cm[1]])[0];
      if (!child) continue;
      const childInner = stripJsxComments(child.inner);
      const sm = childInner.match(SINGLE_LUCIDE_RE);
      if (!sm || !lucide.has(sm[1])) continue;
      found.push({
        file: rel,
        line: span.line,
        icon: sm[1],
        hasLabel: /aria-label\s*=/.test(child.openTag) || /aria-label\s*=/.test(span.openTag),
        hasSrOnly: /sr-only/.test(child.inner),
      });
    }
  }
  return found;
}

describe("R137 (3-c) — icon-only buttons in the r137 extract surface carry accessible names", () => {
  it("scans a non-empty extract inventory (the walker failing silently would pass vacuously)", () => {
    // R181: 152 → 148 — the copilot/* extracts (20 files) left, the four
    // retired calculator extracts left pricing/*; the walker's own count
    // is the truth a shell `ls | wc -l` overcounts.
    expect(extractFiles.length).toBeGreaterThanOrEqual(140);
    const iconOnly = collectIconOnlyButtons();
    // the 3-c audited inventory: 23 single-lucide buttons across 19 files
    // (all 23 labeled — 21 pre-existing wins, 2 fixed by 3-c); R181
    // removed the copilot/* extracts (7 of the 23 lived there), so the
    // floor re-baselines to 16 across 15 files. A DROP below this means
    // files moved out of the extract dirs (the floor
    // fails loudly instead of the labeling check passing vacuously).
    expect(iconOnly.length).toBeGreaterThanOrEqual(16);
  });

  it("every icon-only button is labeled (aria-label / aria-labelledby / sr-only) — zero unnamed", () => {
    const unlabeled = collectIconOnlyButtons().filter((b) => !b.hasLabel && !b.hasSrOnly);
    expect(
      unlabeled.map((b) => `${b.file}:${b.line} <${b.icon}>`),
      "icon-only buttons missing an accessible name (add a concise Arabic aria-label — mirror any existing title)",
    ).toEqual([]);
  });

  it("every Button-asChild icon-only child is labeled too (currently zero — stays zero)", () => {
    const unlabeled = collectAsChildIconOnly().filter((b) => !b.hasLabel && !b.hasSrOnly);
    expect(
      unlabeled.map((b) => `${b.file}:${b.line} <${b.icon}>`),
      "Button asChild icon-only children missing an accessible name",
    ).toEqual([]);
  });

  it("spot-pins seven representative icon-only buttons (the 3-c pair + the batch-1..15 survivors)", () => {
    // The two 3-c fixes: the dashboard CSV-export pair had `title` only —
    // hover-only, no AT name — the fix MIRRORS the title text.
    const chartPickers = read("src/components/admin/dashboard/ChartPickers.tsx");
    expect(chartPickers).toContain('title="تصدير بيانات المخطط CSV"');
    expect(chartPickers).toContain('aria-label="تصدير بيانات المخطط CSV"');

    const newUsersChart = read("src/components/admin/dashboard/NewUsersChart.tsx");
    expect(newUsersChart).toContain('title="تصدير CSV"');
    expect(newUsersChart).toContain('aria-label="تصدير CSV"');

    // Five survivors from the decomposition waves — one per family, so a
    // regression in any batch's a11y idiom trips here.
    expect(read("src/components/admin/products/ProductsToolbar.tsx")).toContain(
      'aria-label="مسح البحث"',
    );
    expect(read("src/components/admin/topups/TopupsToolbar.tsx")).toContain(
      'aria-label="مسح البحث"',
    );
    expect(read("src/components/admin/alerts/AlertsHeader.tsx")).toContain(
      'aria-label="تحديث التنبيهات"',
    );
    expect(read("src/components/admin/tickets/TicketDetailPane.tsx")).toContain(
      'aria-label="إغلاق تفاصيل التذكرة"',
    );
    expect(read("src/components/admin/layout/SearchTriggers.tsx")).toContain(
      'aria-label="بحث سريع"',
    );
  });
});
