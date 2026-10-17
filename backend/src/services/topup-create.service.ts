import { db, usersTable, walletTopupsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { normalizeLibyanPhone } from "../lib/crypto";
import {
  claimIdempotencyKey,
  findIdempotentOrderId,
  isIdempotencyKeyViolation,
  scopeIdempotencyKey,
} from "../lib/idempotency";
import { formatLyd, roundLydString } from "../lib/money";
// R158 (B-F4): the shared payment-network registry (allowlist + labels).
import {
  PAYMENT_NETWORK_ALLOWLIST,
  PAYMENT_NETWORK_INVALID_MESSAGE,
} from "../lib/payment-networks";
import { scoreEventFireAndForget } from "../lib/risk-emit";
import { derivePrimaryProvider } from "../lib/user-provider";
import { createNotification } from "../notify";
import { notifyNewTopup } from "../telegram";

// ── Topup creation ────────────────────────────────────────────────────────────
//
// R158 (B-F1 split): the creation pipeline extracted from the route lives
// here, not in topup.service.ts — the service file that also owns
// approve/reject crossed the R143 1,000-line no-monolith gate the moment
// the pipeline moved in. topup.service.ts keeps the TopupService facade
// (static createPendingTopup delegates here) so every importer reads ONE
// surface; this file owns exactly one thing: turning a validated
// submission into a PENDING topup row (validation battery → durable
// idempotency replay → advisory-lock transaction → auto-reject heuristic
// → operator/customer notifications → risk emit).

/** B2-F2: sender_phone column is varchar(20) — bound for EVERY method. */
const SENDER_PHONE_MAX = 20;
/** B2-F2: sender_account column is varchar(255). */
const SENDER_ACCOUNT_MAX = 255;

// ── Topup creation (R158 B-F1: extracted from routes/wallet.ts POST /topups) ─

/**
 * CheckoutResult-style union for topup CREATION (mirrors
 * services/checkout.service.ts): ok:true carries the topup row plus the
 * idempotentReplay flag the route maps to 200 + Idempotent-Replayed
 * (nothing new was created); ok:false carries a reason the HTTP layer
 * (routes/wallet.ts) maps to its status + envelope — keeping responses
 * byte-identical to the previous inline handler.
 */
export type CreatePendingTopupResult =
  | {
      ok: true;
      topup: typeof walletTopupsTable.$inferSelect;
      /**
       * F10 (round-94 A4) contract, checkout-parity: true when this
       * call REPLAYED the pending topup a previous call with the same
       * Idempotency-Key already created — nothing was inserted, and no
       * operator/customer notification or risk emit fired in THIS call.
       * Routes use it to set `Idempotent-Replayed: true`, return 200
       * (not 201), and skip the new-topup side effects.
       */
      idempotentReplay?: boolean;
    }
  // The conditional validation battery behind the generated zod
  // perimeter (the route answers the generic 400 for a safeParse
  // failure; these are the handler-enforced semantic bounds — the
  // exact Arabic message rides the result).
  | { ok: false; reason: "VALIDATION_ERROR"; message: string }
  // R134 (A7-F4): same Idempotency-Key, DIFFERENT body — the classified
  // 409 (the Redis layer's envelope verbatim, via
  // idempotencyReuseBody() at the route).
  | { ok: false; reason: "IDEMPOTENCY_KEY_REUSE" }
  // Lost the same-key race to a concurrent duplicate AND the winner's
  // claim is no longer replayable — the honest retryable 409.
  | { ok: false; reason: "IN_FLIGHT_CONFLICT" }
  // B4-R1: the same receipt (user + reference + amount) already has a
  // PENDING row under a different idempotency key.
  | {
      ok: false;
      reason: "DUPLICATE_PENDING_REFERENCE";
      message: string;
      existingTopupId: number;
    }
  // Anti-abuse cap: MAX_PENDING pending requests per user (429).
  | { ok: false; reason: "TOPUP_LIMIT_EXCEEDED"; pendingCount: number; limit: number };

/** The failure reasons createPendingTopup can answer with. */
export type CreateTopupFailureReason = Extract<CreatePendingTopupResult, { ok: false }>["reason"];

export interface CreatePendingTopupInput {
  userId: number;
  /**
   * The zod-parsed CreateTopupBody fields (the route owns safeParse —
   * the generated schema is the outer perimeter; the conditional
   * semantic bounds behind it run in the service, reason
   * VALIDATION_ERROR).
   */
  amount: number;
  paymentMethod?: "mobile_transfer" | "lypay";
  paymentNetwork?: string | null;
  senderPhone?: string | null;
  senderAccount?: string | null;
  paymentReference?: string | null;
  /**
   * F10 (round-94 A4) wiring, checkout-parity: the raw
   * `Idempotency-Key` header value, passed through by the route. The
   * service scopes it per-user, replays the original topup row on a
   * retry, and claims it atomically inside the creation transaction.
   * Absent / undersized / oversized keys run the legacy unguarded path
   * (parity with the HTTP middleware's minimum-length rule).
   */
  idempotencyKey?: string;
  /**
   * R134 (A7-F4): the request body's canonical hash — computed at the
   * ROUTE layer off req.body (the SAME definition the Redis layer
   * uses; this service never re-derives it). The durable reuse
   * predicate: a retry reusing the key with a DIFFERENT body is the
   * classified 409 IDEMPOTENCY_KEY_REUSE, never a replay of a
   * different intent's result.
   */
  idempotencyBodyHash: string;
  /**
   * R158 (B-F1): the request-context translation — the risk pipeline's
   * topup_attempt emit needs the caller's IP + User-Agent; the route
   * passes them through so the service never touches the HTTP layer.
   */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Create a PENDING topup request (the manual mobile-transfer /
 * lypay submission flow).
 *
 * R158 (B-F1): this sequence lived inline in routes/wallet.ts POST
 * /topups (~542 lines) while every sibling money path delegated
 * (orders.ts → CheckoutService.purchase; admin/users.ts →
 * AdjustmentService). Moved here verbatim — validation battery →
 * durable idempotency replay → advisory-lock transaction →
 * auto-reject heuristic → operator/customer notifications → risk
 * emit — behind the CheckoutResult-style typed result union so the
 * HTTP layer maps `reason` → status + envelope, keeping responses
 * byte-identical to the previous inline handler. The route keeps:
 * parse → risk-guard translation → response mapping.
 */
export async function createPendingTopup(
  input: CreatePendingTopupInput,
): Promise<CreatePendingTopupResult> {
  const { userId, amount } = input;
  const paymentMethod = input.paymentMethod;
  const paymentNetwork = input.paymentNetwork;
  const senderPhone = input.senderPhone;
  const senderAccount = input.senderAccount;

  // F-03 (round-93 A2 §"Duplicate-transfer double-credit"): normalize the
  // transfer receipt/reference HERE so every downstream dedup layer
  // (V1-M9 partial unique index, the B2-02 in-tx exact check, the advisory
  // lock, the composite soft-dedup) compares canonical values — a raw
  // "  REF-1  " would dodge every exact-match guard while still being the
  // same transfer. Handler-enforced semantic bound (the same pattern the
  // CreateTopupBody openapi description documents for the other conditional
  // rules): trimmed + ≤ 100 chars; the generated zod schema remains the
  // looser 255-char outer perimeter. Blank-after-trim → null (the partial
  // index exempts blank refs as the legacy class).
  const paymentReference =
    typeof input.paymentReference === "string" && input.paymentReference.trim().length > 0
      ? input.paymentReference.trim()
      : null;
  if (paymentReference !== null && paymentReference.length > 100) {
    return {
      ok: false,
      reason: "VALIDATION_ERROR",
      // L8a residual (R127-L11, B14 §1): «رمز التحويل» canon — same
      // rename wallet.ts:383-386 (A8 F4) already documented.
      message: "رمز التحويل طويل جداً (الحد الأقصى 100 حرف)",
    };
  }

  if (amount <= 0 || amount > 10000) {
    return { ok: false, reason: "VALIDATION_ERROR", message: "قيمة الشحن غير صالحة" };
  }

  const method = paymentMethod ?? "mobile_transfer";

  // B2-F2: normalize + allowlist the network before any use (it is
  // stored verbatim below, rendered on the Telegram approval card, and
  // compared by the composite dedup — canonical values keep all three
  // honest).
  let network: string | null = null;
  if (paymentNetwork !== undefined && paymentNetwork !== null) {
    network = String(paymentNetwork).trim().toLowerCase() || null;
  }
  if (network !== null && !PAYMENT_NETWORK_ALLOWLIST.has(network)) {
    return {
      ok: false,
      reason: "VALIDATION_ERROR",
      // L8a residual (R127-L11, B14 §1): the copy listed 2 of the
      // 4 allowlist values — sadad/lypay also pass the check above,
      // so the message lied about what the route accepts. All 4
      // now listed with their canonical labels (the shared
      // PAYMENT_NETWORKS registry, lib/payment-networks.ts — A8 F1 /
      // R158 B-F4).
      message: PAYMENT_NETWORK_INVALID_MESSAGE,
    };
  }

  if (method === "mobile_transfer" && !network) {
    return { ok: false, reason: "VALIDATION_ERROR", message: "يرجى اختيار الشبكة" };
  }
  // B2-F2: sender_account is only required for lypay, but ANY method may
  // carry one — bound it to the column so a long value is a 400, not a
  // 22001 500 on the money path.
  if (senderAccount !== undefined && senderAccount !== null) {
    if (String(senderAccount).trim().length === 0 && method === "lypay") {
      return { ok: false, reason: "VALIDATION_ERROR", message: "يرجى إدخال رقم حساب المُرسل" };
    }
    if (String(senderAccount).length > SENDER_ACCOUNT_MAX) {
      return {
        ok: false,
        reason: "VALIDATION_ERROR",
        message: `رقم حساب المُرسل طويل جداً (الحد الأقصى ${SENDER_ACCOUNT_MAX} حرف)`,
      };
    }
  }
  if (method === "lypay" && (senderAccount === undefined || senderAccount === null)) {
    return { ok: false, reason: "VALIDATION_ERROR", message: "يرجى إدخال رقم حساب المُرسل" };
  }

  // B2-F2: sender_phone is validated as a Libyan number for
  // mobile_transfer below, but a lypay submission may carry ANY string
  // (the Telegram approval-card comment) — bound both to the varchar(20)
  // column before the shape check so neither can overflow.
  if (senderPhone !== undefined && senderPhone !== null) {
    if (String(senderPhone).length > SENDER_PHONE_MAX) {
      return {
        ok: false,
        reason: "VALIDATION_ERROR",
        message: `رقم هاتف المُرسل طويل جداً (الحد الأقصى ${SENDER_PHONE_MAX} رقماً)`,
      };
    }
  }

  // R151: hoisted NORMALIZED sender phone — stored normalized (see the
  // insert below), so the R154 duplicate-risk probe must compare against
  // the SAME canonical 9-digit form, not the raw input.
  const normalizedSenderPhone = senderPhone
    ? (normalizeLibyanPhone(senderPhone) ?? senderPhone)
    : null;

  if (method === "mobile_transfer" && senderPhone) {
    if (!normalizeLibyanPhone(senderPhone)) {
      return { ok: false, reason: "VALIDATION_ERROR", message: "رقم هاتف المُرسل غير صالح" };
    }
  }

  // ── R104 (AG9-1, F10 mirror): durable idempotency for topup CREATION ──
  //
  // The HTTP middleware above is the fast Redis layer; without Redis
  // (the production shape) it is a pass-through, so a double-submit /
  // post-timeout retry created DUPLICATE pending rows. Money still
  // only moves at approval (dedup battery: advisory lock + in-tx
  // exact check + V1-M9 partial unique + composite soft-dedup), but
  // that battery requires a payment_reference — an OPTIONAL field —
  // so two ref-less pending rows for one real transfer could both be
  // approved by an operator. The DB-backed claim closes that window:
  // a retry of the same Idempotency-Key now replays the original
  // pending row instead of inserting a second one.
  const scopedIdemKey = scopeIdempotencyKey(userId, input.idempotencyKey);
  // R134 (A7-F4): the durable reuse predicate's input — the body hash
  // is computed at the ROUTE layer off req.body and passed in (the
  // SAME definition the Redis layer uses; this service never
  // re-derives it).
  const idemBodyHash = input.idempotencyBodyHash;
  if (scopedIdemKey) {
    const replayedClaim = await findIdempotentOrderId(scopedIdemKey, "topup.create");
    if (replayedClaim !== null) {
      // R134 (A7-F4): hash mismatch = same key, DIFFERENT submission —
      // the classified 409 (the Redis layer's envelope verbatim), NOT
      // a replay of a different intent's result. NULL hash = a legacy
      // claim (pre-R134 writer) → replay (the ≤48h transition window).
      if (replayedClaim.bodyHash !== null && replayedClaim.bodyHash !== idemBodyHash) {
        return { ok: false, reason: "IDEMPOTENCY_KEY_REUSE" };
      }
      const replayedTopupId = replayedClaim.orderId;
      // R134 (A7-F4): orderId is nullable on the polymorphic column —
      // a NULL (malformed) claim falls through to the fresh path.
      if (replayedTopupId !== null) {
        const [existing] = await db
          .select()
          .from(walletTopupsTable)
          .where(
            and(eq(walletTopupsTable.id, replayedTopupId), eq(walletTopupsTable.userId, userId)),
          )
          .limit(1);
        if (existing) {
          // Same contract as the checkout replay (orders.ts): the
          // route answers 200 (not 201 — nothing new was created) with
          // the Idempotent-Replayed header and the ORIGINAL formatted
          // DTO, and NO new operator notification fires for a replay.
          return { ok: true, topup: existing, idempotentReplay: true };
        }
      }
      // Key points at a topup this user no longer owns (cascade-deleted
      // user row): fall through; the in-tx claim surfaces a still-live
      // stale key as a classified conflict below.
    }
  }

  // Anti-abuse: max 3 pending requests per user.
  //
  // B2-09 (round-92 audit): the count-then-insert pair runs inside ONE
  // transaction guarded by a per-user advisory lock. The old
  // check-then-insert allowed N parallel POSTs to all count 0 pending and
  // all insert (cap bypassed — no direct money impact since each request
  // still needs manual approval, but the anti-abuse invariant was soft).
  // The advisory lock serializes same-user submissions; count + auto-reject
  // heuristic + insert now see a consistent snapshot and commit atomically.
  const MAX_PENDING = 3;
  const submission = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"topup:" + userId}, 0))`);

    // ── PERF #12 (R136): three serial in-tx SELECTs → one guard statement ──
    // The advisory-lock transaction used to run the B4-R1 duplicate
    // probe → pendingCount → rejectedCount as THREE sequential round
    // trips while holding the per-user pg_advisory_xact_lock. They now
    // collapse into ONE statement: the two counts share a single
    // wallet_topups scan via count(*) FILTER arms (the admin/stats.ts
    // idiom), and the duplicate-receipt probe rides the same statement
    // as a scalar subquery (an EXISTS alone would lose the existing
    // row's id, which the 409 body surfaces as existing_topup_id).
    // Guard semantics identical — the checks below keep their exact
    // order (duplicate 409 BEFORE the pending-cap 429 BEFORE the
    // auto-reject heuristic), and folding into one statement makes the
    // three guards read ONE snapshot instead of three consecutive
    // per-statement snapshots (the advisory lock already serializes
    // same-user submissions, so no observable difference).
    // Round trips inside the lock: 3 → 1.
    //
    // R154 (P1-A): the guard statement now also computes the
    // DUPLICATE-RISK probe for ref-less mobile transfers — the
    // B4-R1 hard-required reference is retired with the storefront
    // field, so mobile_transfer pendings arrive reference-less again.
    // Exact uniqueness CANNOT be claimed from (amount, network,
    // sender) alone — a legitimate customer can top up the same
    // amount twice in a day — so the evidence is surfaced as an
    // operator-visible REVIEW signal (admin note on the pending row
    // + the ⚠ line on the Telegram card), never a blanket rejection.
    // The idempotency-key replay + pending-cap + reference-based
    // guards (for legacy/referenced rows) are unchanged.
    const [guards] = await tx
      .select({
        pendingCount:
          sql<number>`count(*) filter (where ${walletTopupsTable.status} = 'pending')`.mapWith(
            Number,
          ),
        rejectedCount:
          sql<number>`count(*) filter (where ${walletTopupsTable.status} = 'rejected')`.mapWith(
            Number,
          ),
        duplicateId:
          paymentReference !== null
            ? sql<
                number | null
              >`(select id from ${walletTopupsTable} where ${walletTopupsTable.userId} = ${userId} and ${walletTopupsTable.paymentReference} = ${paymentReference} and ${walletTopupsTable.amount} = ${roundLydString(amount)} and ${walletTopupsTable.status} = 'pending' limit 1)`
            : // No reference (lypay optional-ref class) → the B4-R1 probe
              // never ran pre-fold; a SQL null literal keeps the guard
              // inert without a subquery.
              sql<number | null>`null`,
        duplicateRiskIds:
          method === "mobile_transfer" && paymentReference === null && normalizedSenderPhone
            ? sql<
                string | null
              >`(select string_agg(t.id::text, ',') from (select id from ${walletTopupsTable} where ${walletTopupsTable.userId} = ${userId} and ${walletTopupsTable.amount} = ${roundLydString(amount)} and ${walletTopupsTable.paymentNetwork} = ${network} and ${walletTopupsTable.senderPhone} = ${normalizedSenderPhone} and (${walletTopupsTable.status} = 'pending' or (${walletTopupsTable.status} = 'approved' and ${walletTopupsTable.createdAt} >= now() - interval '24 hours')) order by id limit 3) t)`
            : sql<string | null>`null`,
      })
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.userId, userId));

    // B4-R1: creation-time duplicate-receipt guard (referenced records —
    // R154 keeps this intact for any submission that still carries a
    // reference, e.g. legacy clients and lypay receipts). The duplicate
    // shape it closes: the SAME receipt resubmitted under a DIFFERENT
    // idempotency key (or no key at all) — two identical pending cards
    // in the operator queue for one real transfer. Same user + same
    // reference + same (rounded) amount + still pending → 409 with an
    // honest message. Same reference with a DIFFERENT amount is left
    // through: the approval battery (exact-ref check + V1-M9 partial
    // unique) still guarantees the second approval 409s, and blocking it
    // here would false-positive on a bank that reuses receipt strings.
    // Runs inside the per-user advisory lock, so a double-submit race
    // cannot slip two rows past this check.
    if (guards.duplicateId != null) {
      return { kind: "duplicate" as const, existingId: guards.duplicateId };
    }

    if (guards.pendingCount >= MAX_PENDING) {
      return { kind: "limited" as const, pendingCount: guards.pendingCount };
    }

    // (Typed to the topup_status enum — replaces the legacy `as any`.)
    let initialStatus: "pending" | "rejected" = "pending";
    let initialAdminNote: string | null = null;

    // Recharge Verification Heuristic: Auto-reject serial abusers
    if (guards.rejectedCount >= 3) {
      initialStatus = "rejected";
      initialAdminNote = "رفض تلقائي: تاريخ من الطلبات المرفوضة المتكررة (احتيال محتمل)";
    }

    // R154 (P1-A): parse the ref-less duplicate-risk probe (≤3 sibling
    // ids, comma-joined) — pending-or-recently-approved twins on
    // (amount, network, sender). Signal only, never a rejection.
    const duplicateRiskSiblingIds =
      typeof guards.duplicateRiskIds === "string" && guards.duplicateRiskIds.length > 0
        ? guards.duplicateRiskIds
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isInteger(n) && n > 0)
        : [];

    if (duplicateRiskSiblingIds.length > 0 && initialStatus === "pending") {
      const siblingList = duplicateRiskSiblingIds.map((id) => `#${id}`).join("، ");
      initialAdminNote = `⚠️ خطر تكرار محتمل: يوجد طلب آخر بنفس المبلغ والشبكة والمُرسل قيد المراجعة أو معتمد خلال 24 ساعة (${siblingList}) — تحقق من إيصال التحويل قبل الاعتماد`;
    }

    const [topup] = await tx
      .insert(walletTopupsTable)
      .values({
        userId,
        // R102 (money display-vs-storage parity): zod accepts up to 3+
        // decimals but numeric(10,2) rounds SILENTLY — the operator
        // would approve 10.555 while 10.56 is what gets credited.
        // Round at the boundary so the approval card, the credited
        // amount, and the ledger agree. AUD103 (r103): roundLydString —
        // +toFixed(2) missed the exact half-cent case (binary
        // 10.554999… → "10.55"); the epsilon-corrected rounding yields
        // the intended 10.56.
        amount: roundLydString(amount),
        paymentMethod: method,
        paymentNetwork: network,
        // R151: store the NORMALIZED sender phone, not the raw input.
        // The composite soft-dedup (this service's approve()) matches
        // senderPhone as a raw string — two submissions of the same
        // number with different formatting ("0913456789" vs
        // "+218913456789", both valid, both normalize to "913456789")
        // bypassed the dedup and could both be approved, crediting the
        // wallet twice for one real transfer. normalizeLibyanPhone
        // returns the canonical 9-digit form (validated upstream for
        // mobile_transfer; the fallback keeps the raw value for any
        // non-Libyan edge case). sender_account is trimmed for the
        // same reason (the lypay dedup in this service's approve()).
        senderPhone: normalizedSenderPhone,
        senderAccount:
          typeof senderAccount === "string"
            ? senderAccount.trim() || null
            : (senderAccount ?? null),
        paymentReference,
        status: initialStatus,
        adminNote: initialAdminNote,
      })
      .returning();

    // R104 (AG9-1): claim the key INSIDE this transaction — commits
    // atomically with the pending row; a rollback releases it for the
    // client's retry. A concurrent same-key winner throws 23505.
    if (scopedIdemKey) {
      try {
        await claimIdempotencyKey(
          tx as unknown as typeof db,
          scopedIdemKey,
          topup.id,
          "topup.create",
          idemBodyHash, // R134 (A7-F4)
        );
      } catch (err) {
        // R108 (FH-A7 P3-2): the manual `code === "23505"` check missed
        // drizzle-wrapped errors (node-postgres exposes the SQLSTATE on
        // the wrapped .cause — see lib/idempotency.ts); the race loser
        // got a raw 500 instead of the designed replay envelope.
        if (isIdempotencyKeyViolation(err)) {
          return { kind: "replayed" as const };
        }
        throw err;
      }
    }

    return {
      kind: "ok" as const,
      topup,
      initialStatus,
      duplicateRiskSiblingIds,
    };
  });

  if (submission.kind === "replayed") {
    // Lost the same-key race to a concurrent duplicate (double-click
    // with two in-flight POSTs): the winner's row is the real one —
    // replay it exactly like the pre-tx path above.
    if (scopedIdemKey) {
      const winnerClaim = await findIdempotentOrderId(scopedIdemKey, "topup.create");
      if (winnerClaim !== null) {
        // R134 (A7-F4): the committed-concurrently twin — a winner that
        // wrote a DIFFERENT body under this key is the classified 409,
        // never a replay of a different intent's result.
        if (winnerClaim.bodyHash !== null && winnerClaim.bodyHash !== idemBodyHash) {
          return { ok: false, reason: "IDEMPOTENCY_KEY_REUSE" };
        }
        const winnerId = winnerClaim.orderId;
        if (winnerId !== null) {
          const [existing] = await db
            .select()
            .from(walletTopupsTable)
            .where(and(eq(walletTopupsTable.id, winnerId), eq(walletTopupsTable.userId, userId)))
            .limit(1);
          if (existing) {
            return { ok: true, topup: existing, idempotentReplay: true };
          }
        }
      }
    }
    return { ok: false, reason: "IN_FLIGHT_CONFLICT" };
  }

  if (submission.kind === "duplicate") {
    // B4-R1: the same receipt (user + reference + amount) already has a
    // PENDING row — a resubmission under a different idempotency key.
    // 409 with the existing request's id so the user can see it in their
    // list; nothing was inserted (the tx returned before the insert).
    return {
      ok: false,
      reason: "DUPLICATE_PENDING_REFERENCE",
      message: `يوجد طلب شحن قيد المراجعة بنفس المرجع والمبلغ (#${submission.existingId}) — انتظر مراجعته أو أرسل تحويلاً جديداً`,
      existingTopupId: submission.existingId,
    };
  }

  if (submission.kind === "limited") {
    return {
      ok: false,
      reason: "TOPUP_LIMIT_EXCEEDED",
      pendingCount: submission.pendingCount,
      limit: MAX_PENDING,
    };
  }

  const { topup, initialStatus, duplicateRiskSiblingIds } = submission;
  // AUD103-2-F6 (r103): display-vs-storage parity — everything the
  // operator card, the user notification, and the risk pipeline SEE
  // downstream must be the STORED (rounded) amount, not the raw
  // submission (10.555 → stored/credited 10.56 — the approval card used
  // to show the un-rounded value to the human checkpoint).
  const storedAmount = Number(topup.amount);

  // B6-03 (R116) hygiene: projected identity read — notifyNewTopup needs
  // phone and derivePrimaryProvider needs telegramId/firebaseUid (the
  // other identity fields ride the projection for future notify use; a
  // bare select() pulled every users column for nothing).
  const [currentUser] = await db
    .select({
      id: usersTable.id,
      phone: usersTable.phone,
      displayName: usersTable.displayName,
      authProvider: usersTable.authProvider,
      googleId: usersTable.googleId,
      telegramId: usersTable.telegramId,
      firebaseUid: usersTable.firebaseUid,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  // R128 (B8-D2): ONE operator card per PENDING topup — notifyNewTopup
  // now carries the ✅/❌ approve/reject inline keyboard (canon labels,
  // mapped network names, formatLyd amount, «رمز التحويل» — the field
  // set this route's deleted bespoke approval card leaked raw enums
  // through) and rides telegram.ts's shared dispatch pipeline
  // (metrics + retry) instead of a bespoke fetch. An auto-rejected
  // row (serial-abuser heuristic) is NOT awaiting approval and sends
  // no card — its «⏳ بانتظار الموافقة» shape would be false
  // information in a money-approval context.
  if (currentUser && initialStatus === "pending")
    notifyNewTopup({
      phone: currentUser.phone,
      amount: storedAmount,
      network: method === "lypay" ? "LyPay" : (network ?? ""),
      topupId: topup.id,
      provider: derivePrimaryProvider(currentUser),
      paymentReference,
      // R154 (P1-A): the ⚠ duplicate-risk line rides the operator card
      // for ref-less mobile transfers — the review evidence that
      // retired the customer-facing receipt field.
      duplicateRiskSiblingIds: duplicateRiskSiblingIds.length > 0 ? duplicateRiskSiblingIds : null,
    });

  // R154 (P5): the CUSTOMER's side of the topup loop — the first
  // notifications row used to appear only on approve/reject, so the
  // bell + history stayed silent between submission and the operator's
  // verdict (the waiting modal covers the open tab only). Now every
  // GENUINE submission (replays return earlier) writes a persistent
  // «قيد المراجعة» row, and the serial-abuser auto-reject writes its
  // own honest row (previously NOBODY was notified on that path).
  // Best-effort — createNotification never fails the 201.
  if (initialStatus === "pending") {
    await createNotification(
      userId,
      "wallet",
      "تم استلام طلب الشحن",
      `طلب شحن بقيمة ${formatLyd(storedAmount)} قيد المراجعة الآن — سنعلمك فور اعتماده.`,
      "/wallet",
    );
  } else {
    await createNotification(
      userId,
      "wallet",
      "تعذّر قبول طلب الشحن",
      `لم يُقبل طلب الشحن بقيمة ${formatLyd(storedAmount)} (سجلّ طلبات مرفوضة متكررة). تواصل مع الدعم لأي استفسار.`,
      "/support",
    );
  }

  // Risk pipeline (003-anomaly-detection) — emit topup_attempt. Never
  // blocks; gated on RISK_PIPELINE_ENABLED inside scoreEvent.
  scoreEventFireAndForget({
    eventType: "topup_attempt",
    userId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    phone: currentUser?.phone ?? null,
    ruleContext: {
      event: {
        eventType: "topup_attempt",
        ipAddress: input.ipAddress ?? null,
        amount: storedAmount,
      },
      user: { id: userId },
    },
  });

  return { ok: true, topup };
}
