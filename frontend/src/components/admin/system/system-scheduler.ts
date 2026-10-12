import type { CheckStatus } from "@/lib/healthz";
import type { SchedulerResponse } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the scheduler banner derivation (tone + title + message per scheduler
// mode/heartbeat shape — the R108 SINGLE_INSTANCE_MODE tree). Pure
// label/tone builder: the scheduler query, schedMeta and every consumer
// stay in the page/extracts; the move only changes the logic's address,
// zero behavior change (the system-scheduler-banner render suite pins
// every branch's wording).

// ── Scheduler banner state ───────────────────────────────────────────────

export interface SchedulerBanner {
  schedTone: CheckStatus;
  schedTitle: string;
  schedMessage: string;
}

export function deriveSchedulerBanner(scheduler: SchedulerResponse | undefined): SchedulerBanner {
  let schedTone: CheckStatus = "ok";
  let schedTitle = "حالة الجدولة";
  let schedMessage = "";

  if (!scheduler) {
    schedTone = "degraded";
    schedTitle = "حالة الجدولة";
    schedMessage = "جارٍ التحميل...";
  } else if (scheduler.mode === "embedded" && scheduler.active) {
    if (scheduler.heartbeat.expected && !scheduler.heartbeat.healthy) {
      schedTone = "degraded";
      schedTitle = "الجدولة المضمّنة تعمل لكن النبضة متأخرة";
      schedMessage =
        scheduler.heartbeat.ageSec === null
          ? "النبضة لم تُسجَّل بعد منذ الإقلاع — قد تستغرق ~30ث."
          : `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث (المتوقع <60ث).`;
    } else {
      schedTone = "ok";
      schedTitle = "الجدولة المضمّنة نشطة";
      schedMessage = scheduler.description;
    }
  } else if (scheduler.mode === "single" && scheduler.active) {
    // R108 SINGLE_INSTANCE_MODE (Oracle/Coolify target shape): schedulers
    // run ungated in this process — healthy by definition. Heartbeat is
    // only expected when Redis exists (backend sets expected=false + a
    // note when REDIS_URL is unset — the no-Redis production shape), so no
    // stale-heartbeat degradation here.
    if (scheduler.heartbeat.expected && !scheduler.heartbeat.healthy) {
      schedTone = "degraded";
      schedTitle = "الجدولة أحادية الخادم تعمل لكن النبضة متأخرة";
      schedMessage = `آخر نبضة قبل ${scheduler.heartbeat.ageSec ?? "—"}ث (المتوقع <60ث).`;
    } else {
      schedTone = "ok";
      schedTitle = "الجدولة أحادية الخادم نشطة";
      schedMessage = scheduler.description;
    }
  } else if (scheduler.mode === "embedded" && !scheduler.active) {
    schedTone = "degraded";
    schedTitle = "الجدولة المضمّنة في وضع الانتظار";
    schedMessage = scheduler.description;
  } else if (scheduler.mode === "dedicated") {
    if (scheduler.heartbeat.healthy) {
      schedTone = "ok";
      schedTitle = "خدمة worker مستقلة نشطة";
      schedMessage = `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث.`;
    } else {
      schedTone = "failing";
      schedTitle = "خدمة worker المستقلة لا تستجيب";
      schedMessage =
        scheduler.heartbeat.ageSec === null
          ? "لا توجد نبضة من خدمة worker — تحقق من تشغيلها."
          : `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث (المتوقع <60ث).`;
    }
  } else {
    schedTone = "degraded";
    schedTitle = "الجدولة معطّلة";
    schedMessage = scheduler.description;
  }

  return { schedTone, schedTitle, schedMessage };
}
