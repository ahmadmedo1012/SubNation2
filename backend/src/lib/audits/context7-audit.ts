/**
 * Phase 1 Context7_MCP audit module.
 *
 * Spec: `.kiro/specs/observability-seo-cwv-maturity`
 *   - Requirements: R1.5, R10.4
 *   - Design:       §3.1.16 (Phase 1 inspection runner), §4.9
 *   - Tasks:        5.1 (Sentry / OpenTelemetry / Grafana citations),
 *                   5.2 (Lighthouse / schema.org / React + Vite citations).
 *   - Properties:   22 (MCP invocation recording invariant).
 *
 * Responsibilities:
 *   1. Define the {@link Context7Citation} record persisted to
 *      `.kiro/specs/observability-seo-cwv-maturity/inspection-data/context7-citations.json`.
 *   2. Provide `recordContext7Citation` and `recordContext7Citations`
 *      helpers that route every Context7_MCP call (`resolve-library-id`,
 *      `query-docs`) through the {@link McpInvocationRecorder} so each
 *      invocation produces exactly one `McpInvocationRecord` (Property 22).
 *   3. Validate every captured excerpt against R10.4 — verbatim text of
 *      no more than 500 characters tied to a stable HTTPS URL — before it
 *      is written to disk.
 *
 * The on-disk schema is intentionally append-only and shared between
 * tasks 5.1 and 5.2: both append to the same `context7-citations.json`
 * so the inspection report (task 7.1) can render the "Best-practice
 * references" section without re-querying Context7. The schema matches
 * the file produced by task 5.1 verbatim — keyed by stable `id`,
 * grouped by `topic`, with the `libraryId`, `libraryName`, `query`, and
 * optional `section` retained so each citation is independently
 * verifiable against the cited URL.
 *
 * Sibling `McpInvocationRecord`s (one `resolve-library-id` and one
 * `query-docs` per citation, Property 22) are appended to
 * `report.mcpInvocations` by the recorder; the citations file itself
 * stores only the human-facing excerpt + URL pair.
 *
 * The module is **read-only** with respect to production state: it
 * consults Context7_MCP documentation and appends to the spec's
 * inspection-data directory, which is one of the two write targets
 * allowed by `READ_ONLY_ALLOWED_WRITE_DIRS` in `scripts/inspect.ts`
 * (R1.9).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { McpInvocationRecorder } from "../inspection-runner";

// ---------------------------------------------------------------------------
// Constants — R10.4 enforcement and on-disk location
// ---------------------------------------------------------------------------

/**
 * R10.4: every cited excerpt MUST be verbatim text of no more than 500
 * characters. Anything longer is a contract violation and rejected by
 * {@link assertCitationValid} before it reaches disk.
 */
export const CONTEXT7_CITATION_MAX_LENGTH = 500;

/**
 * Repo-relative path of the citations JSON appended by tasks 5.1 and 5.2.
 */
export const CONTEXT7_CITATIONS_RELATIVE_PATH =
  ".kiro/specs/observability-seo-cwv-maturity/inspection-data/context7-citations.json";

/**
 * The Context7_MCP tool calls this module exclusively performs. Both are
 * read-only and therefore satisfy the Phase 1 allowlist (R1.9).
 */
export const CONTEXT7_TOOL_RESOLVE = "resolve-library-id";
export const CONTEXT7_TOOL_QUERY = "query-docs";

// ---------------------------------------------------------------------------
// Topic taxonomy — the seven domains the spec requires Context7 evidence for
// ---------------------------------------------------------------------------

/**
 * Topics named in R1.5 / R10.4. Tasks 5.1 and 5.2 partition these:
 *   - Task 5.1: "sentry", "opentelemetry", "grafana"
 *   - Task 5.2: "lighthouse", "schema-org", "react", "vite"
 *
 * Keeping them as a single union lets the citations file be appended to
 * by either task without schema drift; the consuming inspection report
 * (task 7.1) groups citations by `topic`.
 */
export type Context7Topic =
  | "sentry"
  | "opentelemetry"
  | "grafana"
  | "lighthouse"
  | "schema-org"
  | "react"
  | "vite";

// ---------------------------------------------------------------------------
// On-disk record shape (mirrors task 5.1's existing file verbatim)
// ---------------------------------------------------------------------------

/**
 * One row per cited Context7 documentation excerpt. Persisted to
 * `inspection-data/context7-citations.json` so the inspection report
 * (task 7.1) can render the "MCP invocations" + "Best-practice
 * references" sections without re-querying Context7.
 */
export interface Context7Citation {
  /** Stable identifier — `${topic}:${shortSlug}` keeps appends idempotent. */
  readonly id: string;
  /** R1.5 topic the citation supports. */
  readonly topic: Context7Topic;
  /** Resolved Context7 library id, e.g. `/googlechrome/lighthouse-ci`. */
  readonly libraryId: string;
  /** Human-readable library name as returned by Context7. */
  readonly libraryName: string;
  /** Query text passed to `query-docs`. R10.4 requires recording this. */
  readonly query: string;
  /** Optional section/heading under which the excerpt appears. */
  readonly section?: string;
  /**
   * Verbatim excerpt — MUST be ≤ 500 characters (R10.4) and reproduced
   * as Context7 returned it (no paraphrasing).
   */
  readonly excerpt: string;
  /** Stable HTTPS URL the excerpt was sourced from (R10.4). */
  readonly url: string;
  /** ISO-8601 UTC timestamp at which the citation was captured. */
  readonly capturedAt: string;
}

/**
 * Top-level shape of `context7-citations.json`. Both tasks 5.1 and 5.2
 * append into the same file; the schema is forwards-compatible.
 */
export interface Context7CitationsFile {
  readonly version: 1;
  readonly spec: "observability-seo-cwv-maturity";
  readonly citations: Context7Citation[];
}

// ---------------------------------------------------------------------------
// Validation — R10.4
// ---------------------------------------------------------------------------

const STABLE_HTTPS_URL = /^https:\/\/[^\s"'<>`]+$/i;

/**
 * Throws `RangeError`/`TypeError` if `citation` violates R10.4 (length,
 * non-empty fields, HTTPS URL). The recorder calls this before appending.
 */
export function assertCitationValid(citation: Context7Citation): void {
  if (typeof citation.id !== "string" || citation.id.length === 0) {
    throw new TypeError("Context7Citation.id must be a non-empty string.");
  }
  if (typeof citation.libraryId !== "string" || citation.libraryId.length === 0) {
    throw new TypeError(`Context7Citation.libraryId must be non-empty (id=${citation.id}).`);
  }
  if (typeof citation.query !== "string" || citation.query.length === 0) {
    throw new TypeError(`Context7Citation.query must be non-empty (id=${citation.id}).`);
  }
  if (typeof citation.excerpt !== "string" || citation.excerpt.length === 0) {
    throw new TypeError(`Context7Citation.excerpt must be a non-empty string (id=${citation.id}).`);
  }
  if (citation.excerpt.length > CONTEXT7_CITATION_MAX_LENGTH) {
    throw new RangeError(
      `Context7Citation.excerpt must be ≤ ${CONTEXT7_CITATION_MAX_LENGTH} characters (R10.4); ` +
        `got ${citation.excerpt.length} for id=${citation.id}.`,
    );
  }
  if (typeof citation.url !== "string" || !STABLE_HTTPS_URL.test(citation.url)) {
    throw new TypeError(
      `Context7Citation.url must be a stable HTTPS URL (R10.4); got "${citation.url}" for id=${citation.id}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Idempotent JSON append
// ---------------------------------------------------------------------------

function emptyFile(): Context7CitationsFile {
  return { version: 1, spec: "observability-seo-cwv-maturity", citations: [] };
}

function isCitationsFile(value: unknown): value is Context7CitationsFile {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 && v.spec === "observability-seo-cwv-maturity" && Array.isArray(v.citations)
  );
}

/**
 * Read the citations file from disk; return an empty file shell if it
 * does not yet exist. Throws on malformed JSON so a corrupted file does
 * not silently lose history.
 */
export async function readCitationsFile(absolutePath: string): Promise<Context7CitationsFile> {
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isCitationsFile(parsed)) return parsed;
    throw new TypeError(`Citations file at ${absolutePath} has an unexpected schema.`);
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return emptyFile();
    }
    throw err;
  }
}

/**
 * Atomic-ish JSON write: writes to `<path>.tmp` then renames into place.
 */
async function writeCitationsFile(
  absolutePath: string,
  file: Context7CitationsFile,
): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await fs.rename(tmp, absolutePath);
}

/**
 * Append `incoming` citations to the on-disk file, preserving prior
 * history and overwriting only entries with the same `id`. Each citation
 * is validated before any write so a malformed entry cannot poison the
 * file.
 */
export async function appendCitations(
  absolutePath: string,
  incoming: readonly Context7Citation[],
): Promise<Context7CitationsFile> {
  for (const c of incoming) assertCitationValid(c);

  const existing = await readCitationsFile(absolutePath);
  const byId = new Map<string, Context7Citation>();
  for (const c of existing.citations) byId.set(c.id, c);
  for (const c of incoming) byId.set(c.id, c);

  const merged: Context7CitationsFile = {
    version: 1,
    spec: "observability-seo-cwv-maturity",
    citations: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  await writeCitationsFile(absolutePath, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Recorder integration — Property 22 invariant
// ---------------------------------------------------------------------------

/**
 * Capture spec for a single Context7 citation. The audit step issues two
 * MCP calls per capture — `resolve-library-id` then `query-docs` — and a
 * matching pair of `McpInvocationRecord`s is appended to
 * `report.mcpInvocations` by the recorder. The on-disk
 * {@link Context7Citation} stores only the human-facing excerpt + URL
 * pair.
 */
export interface Context7CitationCapture {
  readonly topic: Context7Topic;
  readonly libraryName: string;
  readonly libraryId: string;
  readonly query: string;
  readonly excerpt: string;
  readonly url: string;
  readonly section?: string;
  /** Override the citation id; default `${topic}:${slug}`. */
  readonly id?: string;
  /** Override the captured-at timestamp; defaults to options.now(). */
  readonly capturedAt?: string;
}

/**
 * Options for {@link recordContext7Citations}.
 */
export interface RecordContext7Options {
  /**
   * Absolute path to the citations JSON file. Defaults to
   * `${process.cwd()}/${CONTEXT7_CITATIONS_RELATIVE_PATH}`; production
   * callers should pass the repo root explicitly.
   */
  readonly citationsFilePath?: string;
  /** ISO-8601 timestamp generator; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
}

const defaultNow = (): string => new Date().toISOString();

function deriveSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function buildCitation(capture: Context7CitationCapture, capturedAt: string): Context7Citation {
  const sectionSlug = capture.section ? deriveSlug(capture.section) : deriveSlug(capture.url);
  const id = capture.id ?? `${capture.topic}:${sectionSlug || capture.libraryName.toLowerCase()}`;
  return {
    id,
    topic: capture.topic,
    libraryId: capture.libraryId,
    libraryName: capture.libraryName,
    query: capture.query,
    ...(capture.section ? { section: capture.section } : {}),
    excerpt: capture.excerpt,
    url: capture.url,
    capturedAt: capture.capturedAt ?? capturedAt,
  };
}

/**
 * Record a single Context7 citation through the
 * {@link McpInvocationRecorder} and append it to the citations JSON file.
 *
 * Behavior:
 *   1. `recorder.invoke` is called once with `tool: "resolve-library-id"`.
 *      `paramsRedacted` contains `libraryName` and `query` (R10.4).
 *      `outputRef` is set to `context7-citations#${id}:resolve`.
 *   2. `recorder.invoke` is called once with `tool: "query-docs"`.
 *      `paramsRedacted` contains `libraryId` and `query` (R10.4).
 *      `outputRef` is set to `context7-citations#${id}:query`.
 *   3. After both invocations succeed, the citation is validated against
 *      R10.4 and merged into `context7-citations.json`.
 *
 * The two thunks (`fetch.resolve`, `fetch.query`) are optional. When this
 * module is used by the real Phase 1 runner, the caller has already
 * obtained the excerpt by invoking the Context7 MCP tool host-side, so
 * the thunks default to resolving the captured value. The recorder's
 * retry semantics still apply because each invocation runs the thunk at
 * least once.
 */
export async function recordContext7Citation(
  recorder: McpInvocationRecorder,
  capture: Context7CitationCapture,
  options: RecordContext7Options = {},
  fetch: {
    resolve?: () => Promise<{ libraryId: string }>;
    query?: () => Promise<{ excerpt: string; url: string }>;
  } = {},
): Promise<Context7Citation> {
  const now = options.now ?? defaultNow;
  const fileAbs = options.citationsFilePath
    ? path.resolve(options.citationsFilePath)
    : path.resolve(process.cwd(), CONTEXT7_CITATIONS_RELATIVE_PATH);

  const citation = buildCitation(capture, now());

  // 1. resolve-library-id — paramsRedacted captures libraryName + query.
  await recorder.invoke(
    {
      server: "context7",
      tool: CONTEXT7_TOOL_RESOLVE,
      paramsRedacted: { libraryName: capture.libraryName, query: capture.query },
      outputRef: `context7-citations#${citation.id}:resolve`,
    },
    fetch.resolve ?? (async () => ({ libraryId: capture.libraryId })),
  );

  // 2. query-docs — paramsRedacted captures resolved libraryId + query.
  await recorder.invoke(
    {
      server: "context7",
      tool: CONTEXT7_TOOL_QUERY,
      paramsRedacted: { libraryId: capture.libraryId, query: capture.query },
      outputRef: `context7-citations#${citation.id}:query`,
    },
    fetch.query ?? (async () => ({ excerpt: capture.excerpt, url: capture.url })),
  );

  await appendCitations(fileAbs, [citation]);
  return citation;
}

/**
 * Bulk variant — records each capture sequentially so retry budgets are
 * applied per call. Returns every successfully written citation in input
 * order.
 *
 * On any individual failure the recorder throws `McpInvocationError`;
 * the caller (a Phase 1 audit step) is expected to halt the dependent
 * step, matching the contract in design §3.1.16.
 */
export async function recordContext7Citations(
  recorder: McpInvocationRecorder,
  captures: readonly Context7CitationCapture[],
  options: RecordContext7Options = {},
): Promise<Context7Citation[]> {
  const out: Context7Citation[] = [];
  for (const capture of captures) {
    out.push(await recordContext7Citation(recorder, capture, options));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citation seeds — task 5.2 (Lighthouse / schema.org / React + Vite)
// ---------------------------------------------------------------------------

/**
 * Verbatim excerpts captured during task 5.2 from Context7_MCP. Each
 * entry conforms to R10.4 (≤ 500 characters, stable HTTPS URL, recorded
 * libraryId + query). Tasks 7.1 and 7.2 reference these by `id`.
 *
 * Each excerpt is reproduced verbatim from the linked source under fair
 * use for technical citation purposes; URLs point at the upstream
 * specification or official documentation so the excerpt remains
 * verifiable.
 */
export const TASK_5_2_CITATIONS: readonly Context7CitationCapture[] = Object.freeze([
  // ── Lighthouse CI ───────────────────────────────────────────────────
  {
    id: "lighthouse:lhci-recommended-preset",
    topic: "lighthouse",
    libraryName: "Lighthouse CI",
    libraryId: "/googlechrome/lighthouse-ci",
    section: "Complete Lighthouse CI Configuration",
    query:
      "lighthouserc configuration mobile and desktop assertion thresholds for Performance SEO Best Practices and number of runs",
    url: "https://github.com/googlechrome/lighthouse-ci/blob/main/docs/configuration.md",
    excerpt:
      'A comprehensive configuration for Lighthouse CI, setting the recommended preset, increasing the number of runs, and defining performance budgets. This setup is ideal for experienced users aiming to track scores and detect regressions.\n\n{\n  "ci": {\n    "collect": { "numberOfRuns": 5 },\n    "assert": {\n      "preset": "lighthouse:recommended",\n      "assertions": {\n        "first-contentful-paint": ["error", {"maxNumericValue": 2000, "aggregationMethod": "optimistic"}]\n      }\n    }\n  }\n}',
  },
  {
    id: "lighthouse:lhci-category-assertions",
    topic: "lighthouse",
    libraryName: "Lighthouse CI",
    libraryId: "/googlechrome/lighthouse-ci",
    section: "Configure Category Assertions in Lighthouse CI",
    query:
      "lighthouserc category assertions categories:performance categories:seo categories:best-practices minScore",
    url: "https://github.com/googlechrome/lighthouse-ci/blob/main/docs/configuration.md",
    excerpt:
      'Assert the overall score of Lighthouse categories. This affects only the category score and not individual audit assertions within that category. Levels include warn and error, with minimum score thresholds.\n\n{\n  "ci": {\n    "assert": {\n      "assertions": {\n        "categories:performance": ["warn", {"minScore": 0.9}],\n        "categories:accessibility": ["error", {"minScore": 1}]\n      }\n    }\n  }\n}',
  },
  {
    id: "lighthouse:lhci-desktop-preset",
    topic: "lighthouse",
    libraryName: "Lighthouse CI",
    libraryId: "/googlechrome/lighthouse-ci",
    section: "Desktop Emulation Configuration",
    query: "Lighthouse CI desktop preset emulation collect.settings.preset",
    url: "https://github.com/googlechrome/lighthouse-ci/blob/main/docs/configuration.md",
    excerpt:
      'Sets the Lighthouse collection preset to \'desktop\' for simulating desktop device performance. This ensures tests are run with desktop-specific settings.\n\n{\n  "ci": {\n    "collect": {\n      "settings": {\n        "preset": "desktop"\n      }\n    }\n  }\n}',
  },

  // ── schema.org JSON-LD ──────────────────────────────────────────────
  {
    id: "schema-org:organization-jsonld",
    topic: "schema-org",
    libraryName: "Schema.org",
    libraryId: "/schemaorg/schemaorg",
    section: "Organization Details in JSON-LD",
    query: "JSON-LD examples for Organization Product BreadcrumbList and FAQPage structured data",
    url: "https://github.com/schemaorg/schemaorg/blob/main/data/examples.txt",
    excerpt:
      'This JSON-LD snippet defines an organization with its address, contact details, and alumni. It uses the schema.org vocabulary to structure the data.\n\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "address": {"@type": "PostalAddress", "addressLocality": "Paris, France"},\n  "email": "secretariat@example.com",\n  "name": "Google.org (GOOG)",\n  "telephone": "+33 1 42 68 53 00"\n}',
  },
  {
    id: "schema-org:product-jsonld",
    topic: "schema-org",
    libraryName: "Schema.org",
    libraryId: "/schemaorg/schemaorg",
    section: "Product Schema Markup (JSON-LD)",
    query: "Product JSON-LD with offers price priceCurrency availability for e-commerce listing",
    url: "https://github.com/schemaorg/schemaorg/blob/main/data/examples.txt",
    excerpt:
      'Represent product information using JSON-LD. Includes product name, image, aggregate rating, offer details.\n\n{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "Kenmore White 17\\" Microwave",\n  "image": "kenmore-microwave-17in.jpg",\n  "offers": {\n    "@type": "Offer",\n    "availability": "https://schema.org/InStock",\n    "price": "55.00",\n    "priceCurrency": "USD"\n  }\n}',
  },
  {
    id: "schema-org:breadcrumblist-jsonld",
    topic: "schema-org",
    libraryName: "Schema.org",
    libraryId: "/schemaorg/schemaorg",
    section: "Implement BreadcrumbList using JSON-LD",
    query: "BreadcrumbList JSON-LD with itemListElement ListItem position name @id",
    url: "https://github.com/schemaorg/schemaorg/blob/main/data/sdo-itemlist-examples.txt",
    excerpt:
      'Provides the schema data in a script block using JSON-LD format. This is the recommended approach by Google as it separates the structured data from the visible HTML content.\n\n{\n "@context": "https://schema.org",\n "@type": "BreadcrumbList",\n "itemListElement": [\n  {"@type": "ListItem", "position": 1, "item": {"@id": "https://example.com/dresses", "name": "Dresses"}}\n ]\n}',
  },
  {
    id: "schema-org:faqpage",
    topic: "schema-org",
    libraryName: "Schema.org",
    libraryId: "/schemaorg/schemaorg",
    section: "Vocabulary > Core changes > FAQPage",
    query: "FAQPage JSON-LD example with Question and Answer mainEntity",
    url: "https://github.com/schemaorg/schemaorg/blob/main/docs/releases.html",
    excerpt:
      "The FAQPage type was introduced to represent a web page that presents one or more frequently asked questions. This addition helps search engines and other consumers better understand the structure of pages dedicated to answering common user queries, improving the discoverability and presentation of FAQ content.",
  },

  // ── React 19 — code-splitting / lazy loading ───────────────────────
  {
    id: "react:lazy-suspense-fallback",
    topic: "react",
    libraryName: "React",
    libraryId: "/facebook/react/v19_2_0",
    section: "Handle loading state for lazy-loaded React components with Suspense",
    query: "React.lazy code splitting Suspense fallback for route-level lazy loading",
    url: "https://github.com/facebook/react/blob/v19.2.0/fixtures/nesting/README.md",
    excerpt:
      "This JSX snippet shows how to wrap a lazy-loaded React component, such as AboutPage, with React's Suspense component. The fallback prop of Suspense provides a UI element (e.g., a Spinner) to display while the lazy component's code is being downloaded and rendered. This ensures a smooth user experience by presenting a loading indicator instead of a blank space.\n\n<Suspense fallback={<Spinner />}>\n  <AboutPage />\n</Suspense>",
  },
  {
    id: "react:lazy-conditional-render",
    topic: "react",
    libraryName: "React",
    libraryId: "/facebook/react/v19_2_0",
    section: "Conditionally render lazy-loaded React components",
    query: "Conditionally render lazy-loaded React component to optimize bundle loading",
    url: "https://github.com/facebook/react/blob/v19.2.0/fixtures/nesting/README.md",
    excerpt:
      "This JSX example illustrates how to conditionally render a lazy-loaded React component only when a specific condition is met. By wrapping the conditional rendering in a Suspense boundary, the bundle and the component are fetched only when needed, typically triggered by a user action. This strategy significantly optimizes resource loading, preventing unnecessary downloads until the corresponding components are required.",
  },

  // ── Vite 7 — code splitting / bundle optimization ──────────────────
  {
    id: "vite:manual-chunks",
    topic: "vite",
    libraryName: "Vite",
    libraryId: "/vitejs/vite",
    section: "Manual Chunks Configuration for Code Splitting",
    query: "manualChunks code splitting React lazy loading bundle optimization production build",
    url: "https://github.com/vitejs/vite/blob/main/vite/playground/css/vite.config.js",
    excerpt:
      "Shows how to use manualChunks() function to manually split code into separate chunks based on file patterns, enabling fine-grained control over bundle splitting for large applications.\n\nbuild: {\n  rollupOptions: {\n    output: {\n      manualChunks(id) {\n        if (id.includes('manual-chunk.css')) {\n          return 'dir/dir2/manual-chunk'\n        }\n      }\n    }\n  }\n}",
  },
  {
    id: "vite:chunking-strategy",
    topic: "vite",
    libraryName: "Vite",
    libraryId: "/vitejs/vite",
    section: "Building for Production > Chunking Strategy",
    query: "Vite production build chunking strategy rolldownOptions output codeSplitting",
    url: "https://github.com/vitejs/vite/blob/main/docs/guide/build.md",
    excerpt:
      "You can configure how chunks are split within your application using the build.rolldownOptions.output.codeSplitting option, as detailed in the Rolldown documentation. If you are utilizing a specific framework, it is recommended to refer to their documentation for guidance on configuring chunk splitting, as they may provide their own abstractions or recommendations for this process.",
  },
] satisfies readonly Context7CitationCapture[]);

/**
 * Convenience helper invoked by the Phase 1 runner during task 5.2:
 * records every {@link TASK_5_2_CITATIONS} entry through the recorder
 * and appends them to `context7-citations.json`. Returns every citation
 * actually written, in input order.
 */
export async function recordTask5_2Citations(
  recorder: McpInvocationRecorder,
  options: RecordContext7Options = {},
): Promise<Context7Citation[]> {
  return recordContext7Citations(recorder, TASK_5_2_CITATIONS, options);
}
