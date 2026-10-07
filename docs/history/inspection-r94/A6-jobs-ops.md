> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r94/A6-jobs-ops.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# A6 — تفتيش المهام والعمليات (Jobs & Ops) — الجولة 94

**الوكيل:** A6 · **النوع:** قراءة فقط (لم يُعدَّل أي ملف كود) · **التاريخ:** 2026-09-08
**المنطقة:** `backend/src/jobs/**` (14 ملفًا) + `backend/src/worker/**` + `worker.ts` + `migrate.ts` + `lib/web-scheduler.ts` + `lib/scheduler-coordinator.ts` + `lib/boot-migrations.ts` + `index.ts`/`server.ts` + `telegram.ts`/`notify.ts` + `scripts/**` (seed/backup/validate/inspect) + `render.yaml`/`Dockerfile`/`build.mjs`.
**المنهجية:** قراءة سطرية كاملة لـ38 ملفًا + فحص موجّه (grep) لـ18 ملفًا/اختبار. كل نتيجة باقتباس حرفي. المُصلَح في 92/93 (قائمة الممنوعات) لم يُعاد الإبلاغ عنه — تحققتُ من وجوده فعلًا قبل استبعاده.

**الخلاصة العامة:** طبقة المهام في حالة ممتازة إجرائيًا (try/catch في كل callback، مقابض إيقاف، حواجز re-entry، حذف دفعيّ bounded، شاملة unhandledRejection). الثقوب المتبقية كلها في **الحواف**: دوران DDL موروث على جدول `users` كل إقلاع، مسار قيادة غير محروس عند انهيار Redis وقت الإقلاع، وخط نسخ احتياطي بلا تحقق ولا جدولة داخل المستودع.

---

## جدول النتائج

| # | الخطورة | الموقع | العنوان |
|---|---------|--------|---------|
| F1 | P2 | migrate.ts:924-938 ↔ 1402-1408 | دوران ADD/DROP أعمدة legacy على `users` في كل إقلاع |
| F2 | P2 | scheduler-coordinator.ts:119-130 + redis-client.ts:294-327 | قيادة غير محرسة عند إقلاع Redis المعطّل → split-brain دائم حتى النشر التالي |
| F3 | P2 | scripts/src/backup-db.ts + render.yaml + DISASTER_RECOVERY.md | نسخ احتياطي بلا تحقق، غير مجدول داخل المستودع، تدريب استعادة فارغ |
| F4 | P3 | migrate.ts:1083-1105 | ALTER غير محروس على `inventory` + مسح كامل لكلمات المرور كل إقلاع |
| F5 | P3 | flashSaleWatcher.ts:68-73 | تنبيه flash_sale_expired بلا dedupeKey (الوحيد بين الواصفات) |
| F6 | P3 | cron.ts (كل schedule) + Dockerfile:91-96 | TZ ضمني (UTC افتراض Alpine) غير مثبّت — كل الفتحات موثقة كـ UTC |
| F7 | P3 | boot-migrations.ts:69, 351-364 | waitForLeader (60s) < TTL القفل (300s) + fail-open عند خطأ Redis |
| F8 | P3 | alerting.service.ts:275 | `redis.get` خام خارج try وخارج مهلة الأوامر (كسر انضباط R2/R5) |
| F9 | P3 | alertLogger.ts:116-122 + stockWatcher.ts:83-99 | فشل DB يفتح باب Telegram بلا خنق → تنبيه هاتف كل 30 دقيقة طوال العطل |
| F10 | P3 | scripts/src/seed.ts:28,55-60 + migrate.ts:1157-1308 | seed بلا حارس إنتاج لكلمة مرور افتراضية + تضارب كتالوجات + تجديد مخزون dev كل إقلاع |
| F11 | P3 | forecast-retention.ts:35-37، enrichment-retention.ts:22-29، copilot-reaper.ts:25-27 | DELETEs غير مُدفّعة (كسر اتساق B7-P2-5) |
| F12 | P3 | migrate.ts:1833-1864, 1874-1882 | V1-M7/V1-M8: مسح كامل للجدول كل إقلاع بلا علامة إنجاز/فهرس جزئي |

لا توجد P0 (لا مال، لا أمن مباشر). لا شيء من قائمة الممنوعات أعيد الإبلاغ.

---

## التفصيل

### F1 [P2] — دوران DDL موروث على `users` في كل إقلاع بارد

**الموقع:** `backend/src/migrate.ts:924-938` ثم `backend/src/migrate.ts:1402-1408`.

**الدليل (الإضافة، كل إقلاع، بلا شرط):**
```sql
-- migrate.ts:924-938
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS github_id   VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(255) UNIQUE,
  ...
  ADD COLUMN IF NOT EXISTS password_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
```
**والحذف بعدها في نفس التشغيل (Stage C، كل إقلاع):**
```sql
-- migrate.ts:1402-1408
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS password_login_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS legacy_password_disabled_at;
ALTER TABLE users DROP COLUMN IF EXISTS github_id;
ALTER TABLE users DROP COLUMN IF EXISTS facebook_id;
```

**الآلية:** من الإقلاع الثاني فصاعدًا: `CREATE TABLE IF NOT EXISTS users` no-op، ثم كتلة 924 **تعيد إنشاء** الأعمدة الثلاثة التي حذفها Stage C في الإقلاع السابق (github_id بفهرس UNIQUE ضمني، facebook_id كذلك، password_login_enabled)، ثم Stage C **يحذفها مجددًا** — 3× ADD COLUMN + 5× DROP COLUMN (منها 3 no-op `IF EXISTS` لكنها تبقى ALTER TABLE) على جدول `users` **في كل إقلاع بارد، للأبد**.

**الأثر:**
1. يناقض الهدف الموثق في نفس الملف (كتلة otps، أسطر 727-742): *"steady-state boots execute ZERO DDL here"* — إذن حالة الاستقرار المعلنة كاذبة لجدول المستخدمين تحديدًا (جدول كل عملية دخول).
2. كل ALTER يأخذ **AccessExclusiveLock** على `users` — تسلسل لحظي مع طلبات login/checkout أثناء الإقلاع (الإقلاعات متكررة تاريخيًا في هذا المشروع: عدة نشرات/يوم).
3. في نافذة Neon للقراءة فقط، صنف الأمر نفسه (DDL) هو الذي قتل النشر dep-daf0rt8n74is73fraih0 كما يوثق تعليق B7-P0-1 (أسطر 28-34) — بوابة الانتظار للكتابة تحمي، لكن هذه الأوامر تطيل نافذة إعادة المحاولة 5s→15s→45s بلا داعٍ.
4. إن ماتت العملية بين ADD وDROP يبقى عمود موروث عابرًا (غير ضار لكنه انجراف شكلي).

**الإصلاح الدقيق:** احذف `github_id`/`facebook_id`/`password_login_enabled` من قائمة ADD في 924-938 — قواعد منتصف الترحيل تحملها أصلًا (وُجدت قبل Stage C)، والقاعدة الجديدة تنشئها عبر CREATE TABLE (366-394)، وقواعد ما بعد Stage C **يجب ألا تعيدها**. بديل أدق: غلاف DO $$ يتحقق `IF EXISTS (pg_attribute … password_hash)` قبل ADD (علامة "Stage C لم يُطبَّق بعد").

---

### F2 [P2] — قيادة غير محرسة عند إقلاع Redis المعطّل → تشغيل مزدوج دائم

**الموقع:** `backend/src/lib/scheduler-coordinator.ts:119-130` + `backend/src/lib/redis-client.ts:294-327` + `backend/src/server.ts:162`.

**الدليل (منح القيادة بلا قفل عند غياب العميل):**
```ts
// scheduler-coordinator.ts:119-130
if (!redis) {
  logger.warn({ category: "monitoring" },
    "[scheduler] Redis unavailable — granting unguarded leadership (dev only). Production must have REDIS_URL set.");
  return { instanceId, isLeader: true, release: async () => {} };
}
```
والتعليق يفترض أن الإنتاج لن يصل هنا لأن `REDIS_URL` مضبوط — لكن مسار الإنتاج الواصل فعليًا:
```ts
// redis-client.ts:294-327 (degraded boot): .catch((err) => { ... wasBootDegraded = true; ... return null; })
// server.ts:162:  const schedulers = await startWebSchedulers(getRedisClient());  // → null
```
`getRedisClient()` (redis-client.ts:384-387) يعيد null طالما `!isReady`.

**سيناريو مثبت خطوة بخطوة (blue-green + عطل Redis):**
1. النسخة القديمة قائد وتحمل القفل؛ ينقطع Redis → مرجّح TTL يفني (تحديث TTL يفشل ويُبتلع: coordinator 206-210 *"Redis hiccup — leadership state stays as-is"*).
2. Render ينشر نسخة جديدة أثناء العطل → `initRedisClient` ت degraded → `startWebSchedulers(null)` → **isLeader=true فورًا بلا أي قفل** — الكائن المرتجَع **بلا refresher وبلا retry loop ولا onLost** (إرجاع مبكر)، فلا يمكن خفضها (demote) أبدًا.
3. النسخة القديمة تبقى تشغل cron/watchers/alerting (لا demote بدون Redis).
4. يعود Redis: القفل مفقود (TTL انتهى) → النسخة القديمة تعيد اكتساب القفل وتشتغل (سلوك سليم)، لكن **النسخة الجديدة "القائد غير المحروس" لا تعرف شيئًا** — لا refresher ولا مراقبة → **تشغيل مزدوج دائم لكل المهام حتى النشر التالي**.
5. في نافذة العطل نفسها: alerting dedup وrate-limit قائمان على Redis ويفشلان مفتوحًا (`alerting.service.ts:701-704, 725-728` *"failing open"*) → رسائل Telegram/Discord مزدوجة بلا كبت.

**الأثر:** تكرار كل cron/watchers/evaluator بين نسختين إلى أجل غير مسمى. التخفيف القائم: dedupe على مستوى DB لتنبيهات stock/coupon/TOTP، retention idempotent — لكن flashSaleWatcher يكرر (F5)، وkeep-alive يضاعف الـpings.

**الإصلاح الدقيق:** في الإنتاج، لا تمنح القيادة عند `redis === null` — شغّل **حلقة الاكتساب الموجودة أصلًا** (`startRetryTimer`، 250-273) مع مصدر عميل كسول (poll `getRedisClient()` كل 20s) بحيث يُ fires `onAcquired` عند عودة Redis ويشارك القفل مثل الجميع؛ أو على الأقل ابدأ refresherًا ضد `getRedisClient()` ليُخفض عند رؤية قائد آخر. الحالة الحالية صحيحة dev فقط كما يقول التعليق — لكن المسار قابل للوصول من الإنتاج.

---

### F3 [P2] — خط النسخ الاحتياطي: بلا تحقق، بلا جدولة داخل المستودع، تدريب استعادة فارغ

**المواقع:** `scripts/src/backup-db.ts:102-147`، `render.yaml` (كل الخدمات)، `docs/DISASTER_RECOVERY.md:36-45, 164-166`، `scripts/db-backup.sh:13`، `scripts/db-restore.sh:22`.

**الدليل:**
1. **لا تحقق للنسخة:** المخرج الوحيد بعد الكتابة هو الحجم:
```ts
// backup-db.ts:116-120
const stats = await stat(filepath);
console.log(`✓ wrote ${(stats.size / 1024 / 1024).toFixed(2)} MB in ...`);
```
   لا `gzip -t`، لا فحص عدد جداول/صفوف داخل النسخة، لا استعادة تجريبية. ضفّ إلى ذلك: عند فشل `pg_dump` بمنتصف الطريق (110-114) يخرج النص بـ1 **لكن الملف الجزئي المُنضَّد يبقى على القرص باسم صالح** (`subnation-<ISO>.sql.gz`) — نسخة تالفة تبدو صالحة للاستخدام اليدوي.
2. **غير مجدول في أي مكان داخل المستودع:** `render.yaml` يعرّف web/redis/worker فقط — لا يوجد `type: cron`. الجدولة "خارج المستودع": `DISASTER_RECOVERY.md:36-41` *"Create a new Render Cron Job (provision separately)… Schedule: 0 3 * * *"*. لا يمكن التحقق من أنها أُنشئت فعلًا، بينما يعلن نفس المستند RPO `≤ 24 h` **معتمدًا عليها** (سطر 9).
3. **التدريب لم يحدث قط:** جدول تمارين الاستعادة (`DISASTER_RECOVERY.md:164-166`): `| _(none yet — first drill due before public launch)_ |` — بينما الإنتاج يستقبل طلبات ومال حقيقي منذ جولات (worklog r5: 3 طلبات حية، سلامة مال 12/12).
4. **ثلاثة نصوص بصيغتين غير متوافقتين:** `backup-db.ts` ينتج plain-SQL مضغوطًا (gzip)، بينما `db-restore.sh:22` يستدعي `pg_restore -c` (يتوقع custom format `pg_dump -F c` الذي ينتجه `db-backup.sh:13` فقط). استعادة منتج `pnpm run db:backup` عبر `db-restore.sh` ستفشل بصيغة خاطئة. و`PROJECT_OVERVIEW.md:206` يوجه المشغل إلى الزوج الضعيف (`.sh`) تحديدًا. كذلك `pg_restore -c` بلا `--if-exists` يفشل على قاعدة غير فارغة، وبلا أي سؤال تأكيد قبل المسح.

**الأثر:** كارثة صامتة محتملة بالمعنى الحرفي: احتياط يومي ربما يكون تالفًا/جزئيًا (يفشل pg_dump أحيانًا مع `--serializable-deferrable` تحت DDL متزامن)، والاكتشاف الوحيد هو يوم الاستعادة الفعلي.

**الإصلاح الدقيق:** (a) بعد الكتابة: `gzip -t` + `SELECT count(*) FROM information_schema.tables` عبر `psql` إلى قاعدة مؤقتة/branch أو على الأقل `zcat | grep -c 'CREATE TABLE'` وحذف الملف عند أي فشل؛ (b) أضف خدمة `type: cron` إلى render.yaml (مجدولة 03:00 UTC، نفس env) بدل "provision separately"؛ (c) وحّد على backup-db.ts واحذف/علّم db-backup.sh+db-restore.sh كـ legacy في PROJECT_OVERVIEW؛ (d) نفّذ أول drill وسجّله في الجدول.

---

### F4 [P3] — ALTER غير محروس على `inventory` + مسح كامل لكلمات المرور كل إقلاع

**الموقع:** `backend/src/migrate.ts:1083-1105`.

**الدليل:**
```ts
// migrate.ts:1083-1084 — بلا حارس طول العمود، ينفذ كل إقلاع يُضبط فيه ENCRYPTION_KEY
if (process.env.ENCRYPTION_KEY) {
  await db.execute(sql`ALTER TABLE inventory ALTER COLUMN account_password TYPE VARCHAR(512)`);
  const result = await db.execute(
    sql`SELECT id, account_password FROM inventory WHERE account_password IS NOT NULL`,  // :1085-1087
  );
```
قارن مع الوضع الصحيح المتطابق في نفس الملف (V1-M6, أسطر 540-550): كتلة DO تتحقق `character_maximum_length = 255` قبل ALTER عمود `orders.delivered_password`.

**الأثر:** (1) DDL بلا شرط على الجدول الأكثر حساسية ماليًا (inventory) كل إقلاع، بنفس صنف الأمر الذي صمم B7-P0-1 لتفاديه؛ (2) الـSELECT يسحب **كل** صفوف كلمات المرور (ciphertext الآن) إلى ذاكرة العملية كل إقلاع — مسح كامل بلا فهرس جزئي ولا فلترة صيغة، مع `statement_timeout` 15s الذي يصبح خطرًا عند عشرات آلاف الصفوف مستقبلًا. (3) عدم اتساق فقط: V1-M7 لـ orders (1833-1858) يفعل نفس المسح الكامل لكن له عذر التاريخية؛ هنا الاثنان معًا.

**الإصلاح الدقيق:** غلاف DO مثل V1-M6 (`IF … character_maximum_length = 255 THEN ALTER`) + إضافة فلترة صيغة `AND account_password NOT LIKE '%:%:%'` (صيغة GCM `iv:tag:ct` تحوي نقطتين) تقلل السحب إلى الصفوف غير المشفرة فعليًا.

---

### F5 [P3] — تنبيه flash_sale_expired بلا dedupeKey

**الموقع:** `backend/src/jobs/flashSaleWatcher.ts:68-73`.

**الدليل:**
```ts
for (const row of expired) {
  await logAdminAlert(
    "flash_sale_expired",
    `انتهت تخفيضات: ${row.title}`,
    `تم إنهاء التخفيضات تلقائياً بعد انتهاء وقتها (${row.endsAt.toISOString()}).`,
  );  // ← بلا { dedupeKey: ... } — الوحيد بين كل الواصفات
}
```
كل الواصفات الأخرى تمرر dedupeKey: stockWatcher.ts:81 (`stock:zero:${id}`)، couponWatcher.ts:84/126، security-advisories.ts:73 (`admin:no-totp`).

**الآلية:** الـUPDATE نفسه idempotent (يعيد تطبيق الشرط، 63-66)، لكن النمط SELECT(52-59)→UPDATE→log يعني أن نسختين تشغّلان معًا (نافذة blueprint النصّية render.yaml:279-286، أو F2) ستقرآن نفس الصفوف قبل أن يهبط أي UPDATE → **تنبيهان متطابقان، لا كبت إطلاقًا**، ولا يمكن حلّهما لاحقًا عبر `resolveAlertsByDedupeKey`.

**الإصلاح الدقيق:** `logAdminAlert(..., { dedupeKey: \`flash:expired:${row.id}\`, dedupeWindowMs: 7*24*3600*1000 })` — سطر واحد.

---

### F6 [P3] — TZ ضمني لكل تعابير cron

**الموقع:** `backend/src/jobs/cron.ts` (كل استدعاء `schedule(...)` بلا خيار timezone: 48, 76, 93, 111, 128, 153, 179, 193, 220, 237, 256, 269, 288) + `Dockerfile:91-96`.

**الدليل:** التوثيق داخل cron.ts يفترض UTC في كل الفتحات (`"5 0 * * *"` ← *"Daily at 00:05 UTC"* في 66؛ `"0 5 * * *"` ← *"05:00 UTC = 07:00 Libya"* في 92). لكن:
```dockerfile
# Dockerfile:91-95 — لا ENV TZ
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
```
node-cron بلا `timezone` يستخدم TZ المحلي للعملية؛ صورة `node:22-alpine` بلا `/etc/localtime` = UTC **بالصدفة الافتراضية**. أي تغيير صورة أساس أو حقن Render لـTZ يحرك كل الفتحات (بما فيها نافذة 05:00 قبل ذروة ليبيا) بصمت تام.

**الإصلاح الدقيق:** `ENV TZ=UTC` في مرحلة runtime من Dockerfile (سطر واحد) + سطر توثيقي في cron.ts؛ أو تمرير `timezone: "Africa/Tripoli"` صراحة إن أريد التوقيت المحلي. (ملحوظة تجميلية: ترقيم التعليقات في cron.ts مكرر — "8." يظهر عند السطرين 170 و249.)

---

### F7 [P3] — waitForLeader أقصر من TTL القفل + fail-open عند خطأ Redis

**الموقع:** `backend/src/lib/boot-migrations.ts:69, 351-364`.

**الدليل:**
```ts
const LOCK_TTL_SEC = 300;              // :68
const WAIT_FOR_LEADER_MAX_MS = 60_000; // :69 — 1 دقيقة فقط
...
async function waitForLeader(): Promise<void> {
  ...
  while (Date.now() - start < WAIT_FOR_LEADER_MAX_MS) {
    try {
      const exists = await redis.exists(LOCK_KEY);
      if (exists === 0) return;
    } catch {
      return;                          // :359-360 — خطأ Redis ⇒ "القائد انتهى"
    }
```
المتابع (follower) ينتظر 60s كحد أقصى بينما القائد قد يبقى داخل نافذة القفل حتى 300s (زائد إعادة المحاولة العابرة 5/15/45s مع `refreshLockTtl` عند 486)؛ بعدها يعيد `bootMigrations` النتيجة `skipped_lock` **ok:true** ويفتح `bootReady` البوابة (server.ts:255-264) بينما الترحيل لا يزال جارًا عند القائد. التعليق نفسه يعترف: *"if leader takes longer, assume done"* (سطر 69).

**الأثر:** نافذة تقديم traffic على مخطط منتصف ترحيل (كل العبارات idempotent/مستقلة، فالخطر نظريًا محدود، لكنه يخالف عقد "never serve on a schema we are still reconciling" المعلن في server.ts:46-47).

**الإصلاح الدقيق:** ارفع الميزانية إلى `LOCK_TTL_SEC*1000 + صغير`، وفي `catch` استمر بالدوران بدل `return` (أو على الأقل عاملها كـ"غير معروف" مع تحقق `getRedisClient()`).

---

### F8 [P3] — `redis.get` خام خارج الحماية في قاعدة worker_heartbeat_missing

**الموقع:** `backend/src/services/alerting.service.ts:272-285`.

**الدليل:**
```ts
private async evalWorkerHeartbeatMissing(rule: AlertRuleSpec): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;
    const raw = await redis.get("worker:heartbeat");   // :275 — خارج try وخارج withRedisCommandTimeout
    if (!raw) return true;
    try {
```
قارن مع الانضباط المفروض في نفس العائلة: heartbeat.ts:60-62 (`withRedisCommandTimeout("worker_heartbeat_set", ...)`) وcoordinator.ts:191-201. الرفض يُلتقط طابقًا أعلى (evaluateRules:192-199) فلا انهيار — لكن: (1) أمر غير محدود زمنيًا قد يعلّق دورة evaluator كاملة (التقييم تتابعي)؛ (2) الـcatch الداخلي (281-284) لا يرى الفشل فتختفي العدّادات الدقيقة؛ (3) انضباط R5 المعلن مكسور في هذا الموضع تحديدًا.

**الإصلاح الدقيق:** `const raw = await withRedisCommandTimeout("heartbeat_rule_get", () => redis.get("worker:heartbeat"), 2_000)` داخل الـtry.

---

### F9 [P3] — فشل DB في logAdminAlert يفتح قناة Telegram بلا خنق

**الموقع:** `backend/src/jobs/alertLogger.ts:116-122` + `backend/src/jobs/stockWatcher.ts:83-85, 137`.

**الدليل (مقصود وموثق):**
```ts
} catch (err) {
    logger.error({ err, type, title }, "Failed to log admin alert");
    // Deliberately NOT suppressed: a DB failure must not also silence the side channels
    return { suppressed: false, id: null };   // ← يفتح notifyLowStock
```
مع فترة stockWatcher 30 دقيقة (stockWatcher.ts:137): أثناء عطل DB ممتد، كل منتج خارج المخزون يرسل رسالة هاتف للمشغل **كل 30 دقيقة طوال العطل** (مثال: 6 منتجات × 48 دورة = ~288 رسالة/يوم) — والتشفير المزدوج بلا معنى لأن الـdrawer نفسه معطل. عطل DB هو بالضبط اللحظة التي لا يحتاج فيها المشغل سبام هاتفيًا.

**الإصلاح الدقيق:** خنق ذاكرة فقط للإشعارات الجانبية: `const notified = new Set<string>()` في stockWatcher/couponWatcher يُضاف إليه `dedupeKey` عند أول notify (يُمسح مع دورة التعافي مثل alertedZero) — الـinsert يظل يحاول كل دورة.

---

### F10 [P3] — سكربت seed: بلا حارس إنتاج + تضارب كتالوج + تجديد مخزون dev كل إقلاع

**المواقع:** `scripts/src/seed.ts:28, 55-60, 66-123`؛ `backend/src/migrate.ts:1152-1156, 1286-1308`.

**الدليل:**
```ts
// seed.ts:28 — لا فحص NODE_ENV
const adminPassword = process.env.ADMIN_PASSWORD ?? "SubNation@2026";
```
بينما migrate.ts يرفض صراحة (1132-1137): *"Never bootstrap a production admin with a known default password… Refusing to seed default-password admin in production"*. تنفيذ `pnpm seed` على DATABASE_URL إنتاجي بلا ADMIN_PASSWORD ينشئ superadmin `permissions: ["all"]` (seed.ts:55-60) بكلمة مرور معروفة في المستودع (أو يعيد تعيينها مع `ADMIN_RESET_PASSWORD=true`).

**تضارب الكتالوجات:** migrate.ts يزرع 12 منتجًا (Netflix Premium بـ14.99، "Disney+ Standard") وseed.ts يزرع 8 (Netflix Premium بـ**45.00**، "Disney+"، "Shahid VIP"…) — تشغيل الاثنين على قاعدة dev ينتج صفوفًا شبه مكررة بأسماء/أسعار متضاربة (5 أسماء متطابقة تُتخطى، و6 تُضاف كتكرار مفهومي).

**تجديد المخزون كل إقلاع (dev/staging فقط):**
```ts
// migrate.ts:1293-1295 — كل إقلاع يُكمل المخزون غير المباع إلى 5
if (invCount < 5) {
  const toAdd = 5 - invCount;
```
قاعدة dev لا يمكن أن تصل إلى نفاد مخزون عبر البيع (يُعاد ملؤها كل إقلاع بـ`SN<id>@Pass` تجريبية) — ما يبطل اختبار سلوك stockWatcher/no_stock على بيئة التطوير بصمت.

**الإصلاح الدقيق:** انقل حارس migrate.ts نفسه إلى seed.ts (رفض `SubNation@2026` في NODE_ENV=production)؛ وحّد الكتالوج التجريبي في مصدر واحد (اجعل seed.ts يستعمل قائمة migrate.ts أو العكس)؛ اجعل تعليب المخزون التجريبي one-shot بعلامة `system_settings` أو احذفه.

---

### F11 [P3] — حذف retention غير مُدفّع في 3 مهام (كسر اتساق B7-P2-5)

**المواقع:** `backend/src/jobs/forecast-retention.ts:35-37`، `backend/src/jobs/enrichment-retention.ts:22-29`، `backend/src/jobs/copilot-reaper.ts:25-27`.

**الدليل (statement واحد غير محدود):**
```ts
// forecast-retention.ts:35-37
const purgeResult = await db
  .delete(inventoryForecastsTable)
  .where(sql`${inventoryForecastsTable.forecastDate} < CURRENT_DATE - INTERVAL '90 days'`);
```
بينما الأقران المُصلحون كلهم دفعات ctid بقفاز 1000: session-prune.ts:30-50، risk-retention.ts:41-63، cleanup-auth-activity.ts:24-48، alertLogger.ts:209-235 (تعليق B7-P2-5: *"keeps lock footprint per statement tiny on Neon's pooler"*).

**الأثر اليوم صفر (الجداول صغيرة: forecasts ≤ 90 يوم × ~19 منتجًا؛ previews ≤ 24h) — لكن أول purge كبير (تفعيل pipeline بعد فترة، أو أول 90 يومًا لcopilot عند تفعيل الاستخدام) ينفذ DELETE واحدًا غير محدود، النمط الذي صنفت الجولة 92 نفسها خطره على pooler.

**الإصلاح الدقيق:** استنساخ دالة `batchedDelete` من risk-retention.ts للجداول الثلاثة (نمط جاهز في نفس المجلد).

---

### F12 [P3] — V1-M7/V1-M8: مسح كامل كل إقلاع بلا علامة إنجاز/فهرس جزئي

**الموقع:** `backend/src/migrate.ts:1833-1864` (V1-M7)، `1874-1882` (V1-M8).

**الدليل:**
```ts
// :1833-1836 — كل إقلاع: كل صفوف delivered_password (ciphertext) تُسحب بالكامل
const legacyRows = (await db.execute(sql`
  SELECT id, delivered_password FROM orders
  WHERE delivered_password IS NOT NULL
`)) as ...
```
وV1-M8 كل إقلاع: `SELECT max(id) GROUP BY (type,title)` ثم `DELETE NOT IN` — idempotent بالمسند لكن بلا "علامة تم" فيpersist (السؤال المحوري: علامة الإنجاز ذاكرة أم DB؟ هنا: لا واحدة — اعتماد كامل على idempotency بالمسند، وهو صحيح لكنه يدفع ثمن مسح كامل كل إقلاع).

**الأثر:** كلفة إقلاع تنمو خطيًا مع orders (لا فهرس جزئي على `delivered_password IS NOT NULL`؛ الفلترة `isEncrypted` تجري في JS بعد سحب كل الصفوف)؛ تحت `statement_timeout` 15s تصبح الفجلة نفسها فشل إقلاع حرج عند التضخم.

**الإصلاح الدقيق:** فلترة صيغة SQL (`AND delivered_password NOT LIKE '%:%:%'`) + فهرس جزئي `CREATE INDEX … ON orders(id) WHERE delivered_password IS NOT NULL AND delivered_password NOT LIKE '%:%'`، أو علامة `system_settings['v1m7_done']` بعد أول تشغيل نظيف.

---

## إجابات الأسئلة التسعة الموجهة (مُثبتة أعلاه)

1. **متانة المهام:** ✅ كل callback في cron.ts داخل try/catch + `captureSchedulerFailure`؛ الواصفات الثلاثة لها catch داخلي؛ **صمام process-level موجود**: instrument.ts:45-59 يلتقط `unhandledRejection` بلا خروج (تعليق صريح: *"Don't exit"*) وuncaughtException يفلت Sentry ثم exit(1). الثغرات المتبقية: F8 (أمر غير محدود)، لا شيء يقتل العملية.
2. **idempotency:** التشغيل المزدوج محرس في DB عبر dedupeKey لكل التنبيهات إلا flash (F5)؛ retention كله idempotent بالمسند — لا يوجد "one-shot يعيد فعلًا غير قابل للتكرار" — لكن تُدفع كلفة إعادة فحص كاملة كل إقلاع (F12) وV1-M8 بلا علامة. العلامات: DB للتنبيهات (dedupe_key)، **لا شيء في الذاكرة يُعتبر ضامنًا** (Sets للإشعار فقط). الحالة الخطرة المتبقية: القيادة غير المحرسة (F2) وworker بلا قفل (موثق render.yaml:279-286 كخطر مقبول bounded).
3. **migrate.ts:** idempotent بانتظام عالٍ، فشل منتصف المراحل يُعاد تشغيله كاملًا بأمان (تصنيف + retry)، إعادة الرمي P0-4 حية (1899-1906)، SQL الخام كله محروس إلا الأربعة المذكورة (F1, F4, F12). ترتيب المراحل صحيح (inventory قبل orders/FKs، otps قبل drop). كلفة الإقلاع: زائد F1/F4/F12.
4. **الإقلاع:** البوابة 503 حتى اكتمال bootstrap (server.ts:51-72) — healthz لا يكذب؛ Redis متأخر → degraded لا crash (H12)؛ DB متأخر → waitForWritableDatabase 120s + retry عابر. عيب worker: لا backoff داخلي لكن exit(1) يعتمد على سياسة Render (مقبول). الثغرة: F7 (follower يفتح البوابة قبل 300s).
5. **cron TZ:** UTC **ضمنيًا** (Alpine) وليس مثبتًا — F6. التزمين الزمني مدروس (00:00/00:05/02:15/03:30/03:35/03:50/04:00/04:30/05:00 متدرجة؛ الدقائق :15/:45 للتفادي). لا أقل فترة بين تشغيلات نفس المهمة (node-cron قد يتراكب نظريًا) لكن كل الواصفات لها in-flight guard واليوميات قصيرة.
6. **الذاكرة:** ✅ نظيفة — alertedExpiring يُنظف >500 (couponWatcher:136-141)، Sets stock محدودة بالكتالوج وتُمسح عند التعافي (stockWatcher:106-110)، counterBaseline محدود بأسماء القواعد. لا Maps نامية في منطقتي.
7. **السجلات:** ✅ REDACT_PATHS مصدّرة ومثبتة باختبار (logger.ts:63-169 + logger-nested-redaction.test.ts)؛ هواتف كاملة لا تُطبع في logs (فقط في رسائل Telegram المشغّل — by design)؛ المستويات سليمة (debug للنجاح، warn للعابر). ثغرة صغيرة: أكواد الكوبونات كاملة في `logger.info` (couponWatcher:89: `codes: expired.map((c) => c.code)`) — حساسية منخفضة (ظاهرة في UI الأدمن أصلًا) فلم أُدرجها كنتيجة مستقلة.
8. **عزل worker tier:** البوابات صحيحة (forecast/enrichment: WORKER_TIER + flags داخل runner، retention الفريقين: `WORKER_TIER !== "true"` return في cron.ts:238/270). الوصفات/التنبيهات العامة تعمل عند "القائد" فقط في الوضع الحالي. العزل الناقص الموثق: worker بلا قائد (render.yaml) + F2.
9. **backup/seed:** F3 (backup) وF10 (seed). seed نفسه idempotent بالاسم (admin:29-49، products:125-136) ✅.

---

## الإيجابيات الموثقة (نموذجية)

- **net على مستوى العملية**: instrument.ts:45-59 — unhandledRejection يُسجل ولا يقتل؛ uncaughtException يفلت Sentry (flush 2s) ثم exit(1).
- **مقابض إيقاف حقيقية في كل مكان**: cron.ts:28-33 (كل `schedule()` يُلتقط)، R8 stop قبل تحرير القفل (web-scheduler.ts:243-257)، worker drain مرتب بـ10s force-exit (worker.ts:36-82).
- **unref() على كل المؤقتات** (stockWatcher:139-140، couponWatcher:162-163، heartbeat:104-107، worker recoveryPoll:121) — لا مؤقت يُبقي عملية حية.
- **try/catch + Sentry لكل مهمة cron** مع `captureSchedulerFailure` يحمل cron_expression.
- **الحذف الدفعي ctid** في 4 وظائف retention (session/risk/auth/alerts) مع تعليقات توضح السبب (Neon pooler).
- **boot-migrations**: بوابة قابلية الكتابة + تصنيف ثلاثي + إعادة تشغيل كاملة بمهل 5/15/45s + refreshLockTtl قبل كل محاولة + compare-and-delete (boot-migrations.ts:379-587).
- **الحارس الرمزي**: migrate.ts:1132-1137 يرفض admin افتراضي في الإنتاج؛ demo seed مقفول في الإنتاج (1152-1156)؛ backfill ["all"] مرة واحدة فقط (1017-1035).
- **notify-gating A6-P2-1**: logAdminAlert يعيد `suppressed` والقنوات تُشرَط عليه (stockWatcher:77-85، couponWatcher:122-130) + اختبارات تثبته.
- **telegram.ts**: مهلة 5s، فحص body، retry عابر فقط، counter لكل نتيجة، escapeHtml، قراءة env وقت النداء — لا `if (isTelegramConfigured)` مطلوب من المستدعي.
- **web-scheduler**: fireOneShot بلا ابتلاع صامت (76-83)، one-shots عند القائد فقط، إعادة اكتساب B7-P1-1، خفض R6.
- **worker**: إقلاع Redis المعطّل → DEGRADED + poll 30s يعيد تعليق heartbeat (worker.ts:97-122)؛ حارس isMainModule آمن كـesbuild ENTRY مع توثيق الفخ (172-184).
- **سكربتات**: import-seo dry-run افتراضيًا + tx واحدة + --force؛ seed idempotent بالاسم؛ validate.ts بميزانية 15 دقيقة (ترويسة 12-22).

## الملفات المفحوصة

قراءة سطرية عميقة: 38 (14 jobs + worker.ts + heartbeat + migrate.ts + index/server + web-scheduler + scheduler-coordinator + scheduler-state + boot-migrations + logger + redis-client + instrument + telegram + notify + alerting.service + seed + backup-db + runtime + start + dev + import-seo + 5 shell/package + render.yaml + Dockerfile + build.mjs + DISASTER_RECOVERY.md). فحص موجّه/اختبارات: 18 (validate.ts، inspect.ts، health.ts، socket.ts، jwt.ts، sentry.ts، 12 ملف اختبار). **الإجمالي: 56 ملفًا. 0 ملفات معدّلة.**
