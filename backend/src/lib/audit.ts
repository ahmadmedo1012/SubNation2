import { auditLogsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

interface AuditParams {
  actorId?: number;
  actorType?: "user" | "admin" | "system";
  action: string;
  targetType?: string;
  targetId?: number;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId: params.actorId ?? null,
      actorType: params.actorType ?? "system",
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (err) {
    logger.error({ err, params }, "Failed to write audit log");
  }
}
