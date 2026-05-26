/**
 * Admin CRUD for flash sales.
 *
 * Operator-facing surface for the previously dormant flash-sales
 * subsystem (audit found read-side wired, write-side absent). The
 * partial unique index `uniq_flash_sales_active_singleton` guarantees
 * at most one active row at the DB level — POST / PATCH catch the
 * unique-violation and translate to a clean Arabic error.
 *
 * Discount-percent ceiling is enforced at 95% so the catalog cannot
 * accidentally enter a "free goods" state when a fixed-amount coupon
 * stacks on top. Operators wanting >95% should use a coupon instead.
 *
 * DELETE soft-deactivates (sets is_active=false) rather than removing
 * the row — keeps history for the audit log.
 */

import { db, flashSalesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { writeAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router: IRouter = Router();

// ── Validation helpers ─────────────────────────────────────────────────────

const MIN_DURATION_MS = 5 * 60 * 1000; // sale must end at least 5min in the future
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days max
const MAX_DISCOUNT_PERCENT = 95;
const MIN_DISCOUNT_PERCENT = 0;

interface CreateBody {
  title?: unknown;
  discount_percent?: unknown;
  ends_at?: unknown;
}

interface UpdateBody extends CreateBody {
  is_active?: unknown;
}

interface ValidationError {
  field: string;
  message: string;
}

function validateCreate(body: CreateBody): { ok: true; data: ValidatedCreate } | { ok: false; error: ValidationError } {
  // discount_percent
  if (typeof body.discount_percent !== "number" || !Number.isFinite(body.discount_percent)) {
    return { ok: false, error: { field: "discount_percent", message: "نسبة الخصم مطلوبة كرقم صحيح." } };
  }
  if (body.discount_percent < MIN_DISCOUNT_PERCENT || body.discount_percent > MAX_DISCOUNT_PERCENT) {
    return {
      ok: false,
      error: {
        field: "discount_percent",
        message: `نسبة الخصم يجب أن تكون بين ${MIN_DISCOUNT_PERCENT}% و ${MAX_DISCOUNT_PERCENT}%.`,
      },
    };
  }

  // ends_at (ISO string)
  if (typeof body.ends_at !== "string") {
    return { ok: false, error: { field: "ends_at", message: "وقت الانتهاء مطلوب." } };
  }
  const endsAt = new Date(body.ends_at);
  if (Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: { field: "ends_at", message: "وقت الانتهاء غير صالح." } };
  }
  const now = Date.now();
  if (endsAt.getTime() < now + MIN_DURATION_MS) {
    return {
      ok: false,
      error: {
        field: "ends_at",
        message: "يجب أن ينتهي العرض بعد 5 دقائق على الأقل من الآن.",
      },
    };
  }
  if (endsAt.getTime() > now + MAX_DURATION_MS) {
    return {
      ok: false,
      error: { field: "ends_at", message: "أقصى مدة للعرض 30 يوماً." },
    };
  }

  // title (optional, defaults applied via DB)
  let title: string | undefined;
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== "string") {
      return { ok: false, error: { field: "title", message: "العنوان يجب أن يكون نصاً." } };
    }
    const trimmed = body.title.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: { field: "title", message: "العنوان فارغ." } };
    }
    if (trimmed.length > 255) {
      return { ok: false, error: { field: "title", message: "العنوان طويل جداً." } };
    }
    title = trimmed;
  }

  return { ok: true, data: { title, discountPercent: body.discount_percent, endsAt } };
}

interface ValidatedCreate {
  title?: string;
  discountPercent: number;
  endsAt: Date;
}

// ── Response shape ─────────────────────────────────────────────────────────

interface FlashSaleResponse {
  id: number;
  title: string;
  discount_percent: number;
  ends_at: string;
  is_active: boolean;
  /** Derived: is_active=true AND ends_at>now() */
  is_currently_active: boolean;
  created_at: string;
}

function toResponse(row: typeof flashSalesTable.$inferSelect): FlashSaleResponse {
  const now = Date.now();
  return {
    id: row.id,
    title: row.title,
    discount_percent: parseFloat(String(row.discountPercent)),
    ends_at: row.endsAt.toISOString(),
    is_active: row.isActive,
    is_currently_active: row.isActive && row.endsAt.getTime() > now,
    created_at: row.createdAt.toISOString(),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/flash-sales — list all (active + historical), newest first.
 */
router.get("/flash-sales", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(flashSalesTable)
    .orderBy(desc(flashSalesTable.createdAt))
    .limit(100);
  return res.json({ flash_sales: rows.map(toResponse) });
});

/**
 * POST /api/admin/flash-sales — create new (activates immediately).
 *
 * Refuses if another active sale exists (DB partial unique index
 * uniq_flash_sales_active_singleton catches it; we translate the
 * 23505 unique-violation to an operator-friendly 409 conflict).
 */
router.post("/flash-sales", requireAdmin, async (req, res) => {
  const validation = validateCreate(req.body ?? {});
  if (!validation.ok) {
    return res.status(400).json(createErrorResponse(validation.error.message, ErrorCode.INVALID_DATA, { field: validation.error.field }));
  }

  try {
    const [row] = await db
      .insert(flashSalesTable)
      .values({
        title: validation.data.title ?? "Flash Sale",
        discountPercent: String(validation.data.discountPercent),
        endsAt: validation.data.endsAt,
        isActive: true,
      })
      .returning();

    void writeAuditLog(req, "flash_sale.create", "flash_sale", row.id, {
      title: row.title,
      discount_percent: validation.data.discountPercent,
      ends_at: row.endsAt.toISOString(),
    });

    return res.status(201).json(toResponse(row));
  } catch (err) {
    // SQLSTATE 23505 = unique_violation. Our partial index rejects
    // a second active row — translate to a 409 with clear guidance.
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return res.status(409).json(createErrorResponse("يوجد عرض نشط بالفعل. أوقف العرض الحالي أولاً قبل إنشاء عرض جديد.", ErrorCode.ALREADY_EXISTS));
    }
    logger.error({ err, category: "admin.flash_sales" }, "flash_sale.create failed");
    throw err;
  }
});

/**
 * PATCH /api/admin/flash-sales/:id — update title / discount / ends_at /
 * is_active. Activating a sale while another is active hits the same
 * partial unique index → 409.
 */
router.patch("/flash-sales/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const body = (req.body ?? {}) as UpdateBody;
  const updates: Record<string, unknown> = {};
  const auditMeta: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (body.title !== null && typeof body.title !== "string") {
      return res.status(400).json(createErrorResponse("العنوان يجب أن يكون نصاً.", ErrorCode.INVALID_DATA));
    }
    if (typeof body.title === "string") {
      const trimmed = body.title.trim();
      if (trimmed.length === 0 || trimmed.length > 255) {
        return res.status(400).json(createErrorResponse("العنوان فارغ أو طويل جداً.", ErrorCode.INVALID_DATA));
      }
      updates.title = trimmed;
      auditMeta.title = trimmed;
    }
  }

  if (body.discount_percent !== undefined) {
    if (typeof body.discount_percent !== "number" || !Number.isFinite(body.discount_percent)) {
      return res.status(400).json(createErrorResponse("نسبة الخصم غير صالحة.", ErrorCode.INVALID_DATA));
    }
    if (body.discount_percent < MIN_DISCOUNT_PERCENT || body.discount_percent > MAX_DISCOUNT_PERCENT) {
      return res.status(400).json(createErrorResponse(`نسبة الخصم يجب أن تكون بين ${MIN_DISCOUNT_PERCENT}% و ${MAX_DISCOUNT_PERCENT}%.`, ErrorCode.INVALID_DATA));
    }
    updates.discountPercent = String(body.discount_percent);
    auditMeta.discount_percent = body.discount_percent;
  }

  if (body.ends_at !== undefined) {
    if (typeof body.ends_at !== "string") {
      return res.status(400).json(createErrorResponse("وقت الانتهاء غير صالح.", ErrorCode.INVALID_DATA));
    }
    const endsAt = new Date(body.ends_at);
    if (Number.isNaN(endsAt.getTime())) {
      return res.status(400).json(createErrorResponse("وقت الانتهاء غير صالح.", ErrorCode.INVALID_DATA));
    }
    if (endsAt.getTime() < Date.now() + MIN_DURATION_MS) {
      return res.status(400).json(createErrorResponse("يجب أن ينتهي العرض بعد 5 دقائق على الأقل من الآن.", ErrorCode.INVALID_DATA));
    }
    updates.endsAt = endsAt;
    auditMeta.ends_at = endsAt.toISOString();
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return res.status(400).json(createErrorResponse("حالة التفعيل يجب أن تكون true/false.", ErrorCode.INVALID_DATA));
    }
    updates.isActive = body.is_active;
    auditMeta.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json(createErrorResponse("لا توجد حقول للتحديث.", ErrorCode.INVALID_DATA));
  }

  try {
    const [row] = await db
      .update(flashSalesTable)
      .set(updates)
      .where(eq(flashSalesTable.id, id))
      .returning();

    if (!row) return res.status(404).json(createErrorResponse("العرض غير موجود.", ErrorCode.NOT_FOUND));

    void writeAuditLog(req, "flash_sale.update", "flash_sale", row.id, auditMeta);
    return res.json(toResponse(row));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return res.status(409).json(createErrorResponse("تفعيل هذا العرض يتعارض مع عرض نشط آخر. أوقف العرض الحالي أولاً.", ErrorCode.ALREADY_EXISTS));
    }
    logger.error({ err, category: "admin.flash_sales" }, "flash_sale.update failed");
    throw err;
  }
});

/**
 * DELETE /api/admin/flash-sales/:id — soft-deactivate. Sets is_active=false
 * but keeps the row for audit history. Use PATCH with is_active:true to
 * reactivate (subject to the singleton constraint).
 */
router.delete("/flash-sales/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [row] = await db
    .update(flashSalesTable)
    .set({ isActive: false })
    .where(eq(flashSalesTable.id, id))
    .returning();

  if (!row) return res.status(404).json(createErrorResponse("العرض غير موجود.", ErrorCode.NOT_FOUND));

  void writeAuditLog(req, "flash_sale.deactivate", "flash_sale", row.id, {
    title: row.title,
  });
  return res.json(toResponse(row));
});

export { router as adminFlashSalesRouter };
