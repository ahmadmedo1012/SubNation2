import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyProductChanged } from "../../../lib/indexnow";

/**
 * R166 (F1) — enrichment publish fires the IndexNow catalog-change ping.
 *
 * Enrichment publishes rewrite the heaviest PDP content
 * (products.description / description_long / faq — the shell Product-LD
 * description and the hydrated page's FAQPage source), yet the R163
 * IndexNow wiring list covered products/variants/inventory/flash/pricing
 * only — every publish silently missed its ping the moment the owner set
 * INDEXNOW_KEY. This suite pins the repaired wiring contract:
 *
 *   - success → notifyProductChanged(before.slug, before.category) fires
 *     EXACTLY once, AFTER db.transaction returns (the identity captured
 *     from the in-tx re-fetch — the pre-change row);
 *   - a slug-less legacy row pings the numeric-id form (the R163
 *     admin-CRUD call shape);
 *   - EVERY failure path stays silent: not_found, wrong_state, the
 *     pre-tx faq-parse failure, "product update returned no row", and a
 *     mid-transaction throw (the rollback case — the notify must sit
 *     after the commit so a rolled-back publish can never ping).
 *
 * Harness note: lib/indexnow is MOCKED (its own submission contract
 * lives in lib/__tests__/indexnow.test.ts); @workspace/db is mocked with
 * a SCRIPTED fake transaction because the real pglite harness cannot
 * drive publishDraft's success path at all — the state-guard heuristic
 * reads `.rowCount ?? .length` off the update result, which pglite does
 * not expose (the pre-existing, service-level limitation documented in
 * admin-enrichment-final-text-cap.test.ts's header — the reason its
 * sibling passthrough test also mocks the service). The drizzle rollback
 * semantics themselves (a throw inside the tx undoes the writes) are
 * pinned by the checkout/top-up atomicity suites; what THIS suite pins
 * is that the notify sits outside them.
 */

const mocks = vi.hoisted(() => {
  /** A thenable whose every method link resolves (or rejects) the same way — the minimal drizzle builder surface publish.ts chains. */
  const chain = (value: unknown, rejection?: Error): unknown => {
    const base: Record<string, unknown> = {
      then: (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        rejection
          ? Promise.reject(rejection).then(onFulfilled, onRejected)
          : Promise.resolve(value).then(onFulfilled, onRejected),
    };
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "then") return Reflect.get(target, prop, receiver);
        return () => chain(value, rejection);
      },
    });
  };

  const table = (name: string) => ({ __table: name });

  /** The tx publish.ts drives: the in-tx re-fetch, the product update, the guarded draft update, the audit insert. */
  const makeTx = (o: {
    before: Record<string, unknown> | null;
    productRows: unknown[];
    draftResult: unknown;
    draftError?: Error;
  }) => ({
    select: () => chain(o.before ? [o.before] : []),
    update: (t: { __table?: string }) =>
      chain(
        t.__table === "products" ? o.productRows : o.draftResult,
        t.__table === "enrichment_drafts" ? o.draftError : undefined,
      ),
    insert: () => chain({ inserted: true }),
  });

  return {
    chain,
    makeTx,
    tables: {
      productsTable: table("products"),
      enrichmentDraftsTable: table("enrichment_drafts"),
      auditLogsTable: table("audit_logs"),
    },
    tx: null as unknown,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mocks.tx as never),
  },
  ...mocks.tables,
}));

vi.mock("../draft-store", () => ({
  getById: vi.fn(),
  markPublished: vi.fn(),
}));

vi.mock("../../../lib/indexnow", () => ({
  indexNowKey: () => null,
  indexNowConfigured: () => false,
  notifyIndexNow: vi.fn(),
  notifyProductChanged: vi.fn(),
}));

// Real module under test (imports the mocked neighbors above).
const { publishDraft } = await import("../publish");
const { getById } = await import("../draft-store");
const getByIdMock = vi.mocked(getById);
const notifyMock = vi.mocked(notifyProductChanged);

const DRAFT_ROW = {
  id: 5,
  productId: 7,
  productName: "Notify Fixture Product",
  productImageUrl: null,
  fieldName: "description" as const,
  state: "drafted" as const,
  generatedText: "وصف عربي كامل بجودة عالية.",
  finalText: null,
  modelId: "test-model",
  inputTokens: 10,
  outputTokens: 10,
  createdAt: new Date(),
  publishedAt: null,
  rejectedAt: null,
};

/** The in-tx re-fetch row — the pre-change product identity. */
const BEFORE_ROW = {
  id: 7,
  slug: "notify-fixture-product",
  category: "streaming",
};

beforeEach(() => {
  notifyMock.mockReset();
  getByIdMock.mockReset();
  mocks.tx = null;
});

describe("publishDraft — the IndexNow notify wiring (R166 F1)", () => {
  it("a SUCCESSFUL publish fires notifyProductChanged ONCE with the re-fetched slug + category, after the commit", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    mocks.tx = mocks.makeTx({
      before: BEFORE_ROW,
      productRows: [BEFORE_ROW],
      draftResult: { rowCount: 1 },
    });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({ kind: "success", productId: 7, field: "description" });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith("notify-fixture-product", "streaming");
  });

  it("a slug-less legacy row pings the numeric-id form (the R163 admin-CRUD call shape)", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    mocks.tx = mocks.makeTx({
      before: { ...BEFORE_ROW, slug: null },
      productRows: [{ ...BEFORE_ROW, slug: null }],
      draftResult: { rowCount: 1 },
    });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome.kind).toBe("success");
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith("7", "streaming");
  });

  it("a mid-tx ROLLBACK never pings — the notify sits after the commit (a throw inside the transaction = failure)", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    // The product update "succeeds" first; the guarded draft update throws
    // (e.g. the published_by FK) — drizzle rolls the whole tx back and the
    // publish must return failure WITHOUT pinging.
    mocks.tx = mocks.makeTx({
      before: BEFORE_ROW,
      productRows: [BEFORE_ROW],
      draftResult: { rowCount: 0 },
      draftError: new Error("published_by FK violation (simulated mid-tx failure)"),
    });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 999_999 });
    expect(outcome).toEqual({
      kind: "failure",
      reason: "published_by FK violation (simulated mid-tx failure)",
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("a state-guard miss (rowCount 0, no throw) also stays silent", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    mocks.tx = mocks.makeTx({
      before: BEFORE_ROW,
      productRows: [BEFORE_ROW],
      draftResult: { rowCount: 0 },
    });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({ kind: "failure", reason: "draft state guard failed (race?)" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("'product update returned no row' stays silent", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    mocks.tx = mocks.makeTx({ before: BEFORE_ROW, productRows: [], draftResult: { rowCount: 1 } });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({ kind: "failure", reason: "product update returned no row" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("'product disappeared mid-transaction' (empty re-fetch) stays silent", async () => {
    getByIdMock.mockResolvedValue(DRAFT_ROW);
    mocks.tx = mocks.makeTx({ before: null, productRows: [], draftResult: { rowCount: 1 } });

    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({
      kind: "failure",
      reason: "product disappeared mid-transaction",
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("not_found stays silent", async () => {
    getByIdMock.mockResolvedValue(null);
    const outcome = await publishDraft({ draftId: 424_242, adminId: 1 });
    expect(outcome).toEqual({ kind: "not_found" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("wrong_state (already published) stays silent", async () => {
    getByIdMock.mockResolvedValue({ ...DRAFT_ROW, state: "published" as const });
    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({ kind: "wrong_state", current: "published" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("an unparseable faq final text fails BEFORE the tx and stays silent", async () => {
    getByIdMock.mockResolvedValue({ ...DRAFT_ROW, fieldName: "faq" as const });
    const outcome = await publishDraft({ draftId: DRAFT_ROW.id, adminId: 1 });
    expect(outcome).toEqual({
      kind: "failure",
      reason: "final_text was not valid {question, answer}[] JSON",
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
