> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r97/database-deep-dive.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# الجولة 97 — أعمق تدقيق لقاعدة البيانات وطبقة البيانات (R97-A3)

> **الوكيل:** R97-A3 (تشخيصي فقط — صفر تعديلات على المصدر، صفر كوميتات، صفر كتابات على قاعدة البيانات).
> **التاريخ:** 2026-09-11 (زمن خادم DB: `now() = 2026-09-11 00:09 UTC`).
> **النطاق:** انجراف schema، تدقيق فهارس، كفاءة استعلامات (EXPLAIN حقيقي)، سلامة transactions، جودة البيانات، pool/Neon، migrations، مهام الاحتفاظ.
> **قاعدة البيانات:** Neon PostgreSQL 17.11 (`ep-spring-term-avwgxrte-pooler…` عبر pooler endpoint) — **37 جدولاً، 132 فهرساً، 92 قيداً، 11MB**.

---

## 1. المنهجية

1. **قراءة خط الأساس:** `worklog.md` (جولات 5/94/96 + وكلاء R97-A1/A2) + `download/db-deep-inspection.json` + `download/db-integrity-report.json` + `docs/db-audit-2026-09-07.md` + `docs/round-94-audit-2026-09-08.md` — لاستبعاد المُصلَح ومنع إعادة الإبلاغ.
2. **قراءة كاملة لطبقة البيانات في المستودع:** كل ملفات `shared/db/src/schema/*.ts` (34 ملفاً/37 جدولاً)، `shared/db/src/index.ts` (pool)، `backend/src/migrate.ts` (2139 سطراً)، `backend/src/lib/boot-migrations.ts`، `jobs/cron.ts`، `lib/web-scheduler.ts`، `lib/scheduler-coordinator.ts`، `lib/redis-client.ts`، `lib/idempotency.ts`، `lib/ledger.ts`، `lib/admin-session.ts`، وكل مسارات/خدمات المال (`checkout/topup/refund/adjustment/loyalty/wallet/orders/admin-*`).
3. **استعلامات قراءة فقط عبر psycopg2** (readonly session + autocommit): `information_schema.columns/pg_indexes/pg_constraint/pg_enum/pg_stat_user_tables/pg_stat_user_indexes/pg_stat_activity` + فحوص سلامة مال + جودة بيانات + `EXPLAIN (COSTS)` و`EXPLAIN (ANALYZE)` على 16 استعلاماً حاراً حقيقياً (SELECT فقط — صفر كتابات).
4. **محاولة `drizzle-kit check`** في `shared/db` (قراءة فقط على meta) — فشلت (انظر R97-DB-08)؛ فاستُبدلت بمقارنة يدوية كاملة عموداً-عموداً بين schema TS وقاموس DB الحي.

---

## 2. الملخص التنفيذي — أهم نتيجة

### 🔴 R97-DB-01 [P1 تشغيلي]: طبقة الـschedulers معطّلة صامتة في الإنتاج منذ ~2026-09-08

كل الأدلة الحية في قاعدة البيانات تتقاطع على نتيجة واحدة: **لا cron ولا watchers ولا alerting evaluator يعمل منذ نحو 2026-09-08 00:59 UTC** (لحظة نشر جولة-5 الذي استُعيدت فيه متغيرات البيئة عبر Render API):

| الدليل الحي (استعلام قراءة فقط)                       | القيمة                                                                                  | الدلالة                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| آخر تنبيه `no_stock`/`low_stock` على الإطلاق          | **2026-09-07 23:30** (id=350)                                                           | منتجات 13–17 **نشطة بمخزون صفر** وdedupe window = 24h → كان يجب إعادة التنبيه يومياً — صمت 3 أيام                   |
| `whatsapp_otps` أقدم من 24h                           | **5 صفوف** (2026-09-08/09)                                                              | الـcron الساعي `:15` (`pruneExpiredOtps`) لم يُطلق مرة واحدة منذ 2026-09-09 22:07                                   |
| `admin_sessions` منتهية > 24h (كلها `revoked=logout`) | **5 صفوف** (انتهت 2026-09-08 20:26–20:36)                                               | الـcron اليومي 05:00 (`pruneStaleAdminSessions`) فات 3 فتحات (9/10/11 سبتمبر)                                       |
| boot تام وحدث بعد انتهاء هذه الصفوف                   | نشر r94 (2026-09-08) + نشر r96 (2026-09-10/11) — migrations ركضت فعلاً (الجداول أُنشئت) | الإقلاع ينجح لكن `startStockWatcher` لم ينبض ولا مرة (أول نبضة بعد 60 ثانية من البدء كانت ستكتب تنبيهات — لم تُكتب) |

**السبب الأرجح (سلسلة سببية كاملة في الكود):** استعادة بيئة جولة-5 (put_result.json — 31 مفتاحاً) **لا تحتوي `REDIS_URL`**؛ و`initRedisClient()` بلا `REDIS_URL` في production يعيد `null` (`redis-client.ts:180-196`)؛ و`startWebSchedulers(null)` بعد إصلاح F2 (جولة-94) **fail-closed**: `acquireSchedulerLeadership` بلا client يعيد `no_client` بلا قيادة (`scheduler-coordinator.ts:250-251, 313-318`)، وحلقة الـretry تستقصي `getRedisClient()` التي تبقى `null` إلى الأبد لأن المتغير غائب من البيئة → **الـwatchers/cron/alerting/heartbeat لا تبدأ إطلاقاً** مع سطر warn واحد فقط في السجلات (`"Redis unavailable at boot — NOT granting leadership (fail-closed, F2)"`).

لاحظ التناقض البنيوي: قفل الـmigrations **fail-open** بلا Redis («No Redis → just run» — `boot-migrations.ts:285-291`) بينما قيادة الـschedulers **fail-closed** بلا Redis — لهذا يقلع التطبيق ويهاجر طبيعياً بينما الطبقة المجدولة مظلمة بلا ضجيج.

**الإصلاح الموصى به:** تحقق من بيئة Render (grep السجلات على `REDIS_URL is missing in production` أو `NOT granting leadership`) → أعِد `REDIS_URL` (خدمة redis في render.yaml موجودة أصلاً) أو قرّر بوعي وضع worker حقيقي. بعدها كل المهام تعود ذاتياً (حلقة retry تلتقط client عند أول إقلاع).

---

## 3. جدول انجراف الـSchema (DB الحي مقابل `shared/db/src/schema/*.ts`)

خلاصة 37 جدولاً: **الأعمدة كلها متطابقة أسماءً وأنواعاً** (فحص عموداً-عموداً). الانجرافات الموجودة كلها في **الفهارس/القيود/الصرامة**:

| #   | الجدول                | العنصر                                                                                         | في DB الحي                                                                                                                                           | في schema TS                                                 | الحكم                                                                                                                            |
| --- | --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `ticket_replies`      | FK `ticket_id → support_tickets(id) ON DELETE CASCADE`                                         | ❌ غير موجود (pkey فقط)                                                                                                                              | ✅ معلن (`ticket_replies.ts:13-15`)                          | **انجراف P2 — ب SQL الإنشاء (`migrate.ts:784-792`) لا ينشئه، وقائمة FKs اللاحقة (`migrate.ts:1244-1254`) تتجاهله**               |
| D2  | `ticket_replies`      | `idx_replies_ticket (ticket_id, created_at)`                                                   | ❌ غير موجود                                                                                                                                         | ✅ معلن (`ticket_replies.ts:19-21`)                          | **انجراف P2 — EXPLAIN يؤكد Seq Scan على كل استعلام ردود تذكرة**                                                                  |
| D3  | `orders`              | `discount_amount` NOT NULL DEFAULT 0.00                                                        | ✅ NOT NULL                                                                                                                                          | ⚠️ nullable (`.default()` بلا `.notNull()` — `orders.ts:70`) | انجراف صرامة (DB أصرم؛ `drizzle-kit generate` سيقترح `DROP NOT NULL` — إضعاف غير مرغوب)                                          |
| D4  | `users`               | `firebase_uid`                                                                                 | **3 فهارس**: `users_firebase_uid_key` (UNIQUE كامل) + `idx_users_firebase_uid` (عادي) + `idx_users_firebase_uid_unique` (UNIQUE جزئي WHERE NOT NULL) | معلن unique + `idx_users_firebase_uid`                       | **2 فهرسا زائدين** (الكامل UNIQUE يغني عن الآخرين)                                                                               |
| D5  | `users`               | `referral_code`                                                                                | `users_referral_code_key` (UNIQUE كامل) + `idx_users_referral_code` (جزئي WHERE NOT NULL)                                                            | معلن unique + `idx_users_referral_code` عادي                 | فهرس زائد + تعريف جزئي في DB مقابل عادي في schema                                                                                |
| D6  | `users`               | `idx_users_phone_trgm` (GIN trgm)                                                              | ✅ موجود (أنشأه `migrate.ts:2028-2031`)                                                                                                              | ❌ **غير معلن في users.ts**                                  | live-only: `drizzle-kit push` سيُسقطه (نفس فخ system_settings القديم — المنتجات عولجت بمرآة `idx_products_name_trgm`، الهاتف لا) |
| D7  | `inventory_forecasts` | `idx_forecasts_at_risk_runout` (جزئي WHERE at_risk)                                            | ✅ موجود (boot SQL)                                                                                                                                  | ❌ غير معلن في schema                                        | live-only — نفس فخ push                                                                                                          |
| D8  | `wallet_topups`       | `uniq_wallet_topups_payment_reference` (UNIQUE جزئي: not-null + non-blank + status='approved') | ✅ موجود                                                                                                                                             | ❌ **غير معلن**                                              | live-only لحرز مال (B2-02) — `push` سيُسقط حاجز ازدواج مرجع الدفع!                                                               |
| D9  | `cart_items`          | FKs `fk_cart_items_user`/`fk_cart_items_product` (CASCADE)                                     | ✅ موجودة                                                                                                                                            | ❌ غير معلنة (schema يكتفي بـunique index)                   | DB أصرم — push سيُسقطهما                                                                                                         |
| D10 | `inventory`           | `idx_inventory_sold`                                                                           | جزئي `WHERE is_sold = false`                                                                                                                         | ⚠️ عادي في schema                                            | DB أفضل (أصغر)؛ تعريف غير متطابق                                                                                                 |
| D11 | `wallet_ledger`       | FK                                                                                             | `fk_wallet_ledger_user` (اسم يدوي، V1-M9)                                                                                                            | مرجع معلن باسم drizzle تقليدي                                | مطابق دلالياً — اسم فقط                                                                                                          |
| D12 | `risk_rules`          | `name`                                                                                         | `risk_rules_name_key` (UNIQUE) + `idx_risk_rules_name` (عادي)                                                                                        | كلاهما معلن (unique + index)                                 | فهرس عادي زائد بنيوياً (الكامل UNIQUE يغطيه)                                                                                     |
| —   | 12 جدولاً حديثاً      | idempotency_keys, admin_sessions, copilot_, enrichment__, forecast_*, risk_*               | كاملة الأعمدة/الفهارس/القيود (CHECK + FK)                                                                                                            | مطابقة                                                       | ✅ لا انجراف                                                                                                                     |

**تحقق إغلاق انجراف جولة-94:** ✅ `idempotency_keys` و`admin_sessions` موجودان حيّين بالأعمدة والفهارس وFKs مطابقة حرفياً لـV1-M12/M13 (`migrate.ts:446-503` DO-blocks idempotent) — **مغلق فعلاً ولا حاجة لإعادة فحصه**.

---

## 4. تدقيق الفهارس (132 فهرساً)

### 4.1 مسارات المال الحرجة — كلها مغطاة ✅

| المسار الحار                      | الاستعلام                                                               | الفهرس الداعم                                                                                                                              | الحالة                                           |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| claims الـorders (insert)         | pkey + `orders_order_code_key`                                          | مغطى                                                                                                                                       | ✅ (تحذير تكلفة: كل INSERT يصون 6 فهارس — مقبول) |
| wallet balance update             | `UPDATE users … WHERE id AND walletBalance=…`                           | pkey فقط (لا فهرس على balance — صحيح)                                                                                                      | ✅                                               |
| idempotency lookup/claim          | `WHERE key = u{id}:{key}`                                               | `idempotency_keys_pkey` — EXPLAIN: **Index Scan** فعلي                                                                                     | ✅                                               |
| sessions (requireUser)            | `WHERE id = $1`                                                         | `sessions_pkey`                                                                                                                            | ✅                                               |
| admin_sessions (requireAdmin sid) | `WHERE id = $1`                                                         | `admin_sessions_pkey` (85 scans)                                                                                                           | ✅                                               |
| alerts dedupe                     | `WHERE dedupe_key=$1 AND created_at > now()-24h`                        | `idx_admin_alerts_dedupe_key (dedupe_key, created_at)` موجود؛ planner يختار Seq Scan (17 صفاً — قرار صحيح الآن، الفهرس سيُستخدم عند النمو) | ✅                                               |
| قوائم أدمن مرقّمة                 | `ORDER BY created_at DESC LIMIT`                                        | `idx_orders_created` (DESC)، `idx_risk_events_created_id_desc` (keyset)، `idx_users_created`                                               | ✅                                               |
| topups طابور pending              | `WHERE status='pending' ORDER BY created_at`                            | `idx_topups_status_created`                                                                                                                | ✅                                               |
| notifications                     | `WHERE user_id ORDER BY created_at DESC LIMIT 40`                       | `idx_notifications_user (user_id, is_read)` — Index Scan مؤكد                                                                              | ✅                                               |
| checkout inventory claim          | `WHERE product_id AND is_sold=false ORDER BY id FOR UPDATE SKIP LOCKED` | `idx_inventory_product_sold` (و`idx_inventory_sold` الجزئي)                                                                                | ✅                                               |

### 4.2 الفهارس غير المستخدمة (idx_scan = 0) — **مع تحفظ منهجي**

`pg_stat_user_indexes`: 71 فهرساً مستخدماً / **61 بصفر scans**. تحفظان: (1) إعادة تشغيل Neon compute تُصفّر العدادات (آخر autoanalyze قديم)، (2) على جداول بحجم 7–70 صفاً يختار الـplanner Seq Scan عمداً — الفهرس «غير مستخدم» ليس «غير مفيد». **التوصية: لا تحذف شيئاً من الفهارس الحاملة للمسارات الحرجة** (ستُستخدم عند النمو). ما يستحق التنظيف فعلاً هو **الازدواج البنيوي** فقط:

| فهرس زائد بنيوياً                                                                            | السبب                                                                         | مخاطرة الحذف                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `idx_users_firebase_uid` + `idx_users_firebase_uid_unique`                                   | `users_firebase_uid_key` (UNIQUE كامل) يغطيهما                                | صفر (القيد يبقى)                                                   |
| `idx_users_referral_code` (جزئي)                                                             | `users_referral_code_key` يغطيه                                               | صفر                                                                |
| `idx_risk_rules_name`                                                                        | `risk_rules_name_key` UNIQUE يغطيه                                            | صفر                                                                |
| `idx_orders_user` / `idx_wallet_ledger_user` / `idx_topups_status` / `idx_inventory_product` | بادئة من composite موجود (`user_created` / `status_created` / `product_sold`) | منخفضة (planner يفضل الأصغر — احتفظ بها إن أردت أداء قراءة فائقًا) |

---

## 5. كفاءة الاستعلامات (EXPLAIN حقيقي على البيانات الحية)

16 استعلاماً مُحللاً — **كلها sub-millisecond بخطط صحيحة عند الحجم الحالي** (الجداول 1–147 صفاً؛ Seq Scan على جدول 7 صفوف هو القرار الأمثل):

| الاستعلام                                        | الخطة                                                 | زمن                |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------ |
| قائمة طلبات المستخدم (join products, LIMIT 200)  | Seq Scan + Sort (7 صفوف)                              | 0.078ms            |
| طلبات أدمن (page/limit)                          | Seq Scan + Sort                                       | 0.045ms            |
| كتالوج المنتجات (subquery joins للمخزون/الطلبات) | Hash joins + HashAggregate — **استعلام واحد، لا N+1** | 0.143ms            |
| wallet ledger مستخدم                             | Seq Scan (20 صفاً)                                    | 0.044ms            |
| notifications                                    | **Index Scan** `idx_notifications_user`               | 0.85ms (cold plan) |
| idempotency lookup                               | **Index Scan** pkey                                   | 0.98ms             |
| topups queue                                     | Hash join                                             | <0.5ms             |
| alerts dedupe                                    | Seq Scan (17 صفاً — صحيح)                             | 0.043ms            |
| ticket_replies                                   | **Seq Scan + Filter(ticket_id)** — بلا فهرس (D2)      | 0.77ms             |

**ملاحظات كفاءة (كلها P3 عند الحجم الحالي):**

- **Q1 [P3]:** بحث أدمن الطلبات `LIKE '%x%'` على `LOWER()` عبر 3 جداول مرتبطة (admin/orders.ts:46-56) — غير قابل للفهرسة (leading wildcard) → seq scan دائم؛ pg_trgm موجود ويستطيع خدمة `order_code` إن ضخُم الجدول.
- **Q2 [P3]:** ترقيم OFFSET في قوائم الأدمن (admin/orders.ts:77) — keyset pagination موجود جاهزاً في risk_events (نمط `created_at DESC, id DESC`)؛ العمق العالي سيكلف.
- **Q3 [P3]:** `routes/coupons.ts:179` — قائمة كوبونات **بلا LIMIT** (جدولان الآن؛ unbounded).
- **Q4 [P3]:** `admin/stats.ts` — تجميعات COUNT/SUM على جداول كاملة (dashboard) — ستحتاج كاش/summary عند النمو.
- **Q5 [P3]:** `copilot/admin-direct.ts:261-287` — حلقة استعلام trigram **لكل candidate** (المعلّق يقول «single SQL query» — التعليق لا يطابق الكود؛ bounded بعدد transliterations، admin-only).
- **إيجابي:** لا N+1 حقيقي في أي مسار ساخن؛ `stockWatcher` نفسه مجموعة COUNT واحدة؛ كل قوائم المتضرّرين محدودة بـLIMIT؛ الـfull-row selects كلها limit(1) بمفاتيح.

---

## 6. سلامة المعاملات (Transactions) — تدقيق كل `db.transaction()`

17 موقع استخدام؛ **كل مسارات المال سليمة بنيوياً**:

| المسار                                                        | فحص الرصيد داخل نفس tx؟                                                                                                 | آلية القفل                                                                                             | ملاحظات                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **checkout** (`checkout.service.ts:228-501`)                  | فحص سريع خارج tx + **CAS داخل tx على (walletBalance, loyaltyPoints, lifetimeSpend)** → `CONCURRENCY_ERROR` قابل للإعادة | `FOR UPDATE SKIP LOCKED` على inventory (H4) + ORDER BY id                                              | ✅ إعادة فحص المنتج/الفلاش/الكوبون داخل tx (F4/B2-05/B2-06)؛ claim المفتاح idempotency داخل نفس الـtx (F10)؛ تنبيهات خارج الـcommit (F8) |
| **topup auto** (`topup.service.ts:78-161`)                    | ✅ قراءة fresh داخل tx + CAS على walletBalance                                                                          | `pg_advisory_xact_lock(hashtextextended(ref))` + فحص ازدواج داخل tx + partial unique index (23505→409) | ✅                                                                                                                                       |
| **topup approve** (`topup.service.ts:221+`, `wallet.ts:210+`) | ✅ نفس النمط                                                                                                            | advisory lock لكل مرجع + لكل مستخدم                                                                    | ✅                                                                                                                                       |
| **refund** (`refund.service.ts:89-255`)                       | ✅ قراءة داخل tx + CAS كامل مجموعة الكتابة                                                                              | status-guarded flip (`WHERE status='completed'`) — استرداد مزدوج يستحيل                                | ✅ إبطال بيانات التسليم داخل نفس tx (B2-03)                                                                                              |
| **adjustment** (`adjustment.service.ts:160-227`)              | ✅                                                                                                                      | CAS على walletBalance                                                                                  | ✅                                                                                                                                       |
| **loyalty convert** (`routes/loyalty.ts:113-152`)             | ✅ قراءة fresh داخل tx                                                                                                  | CAS على (points, balance) معاً                                                                         | ✅                                                                                                                                       |
| **referral credit** (`admin/referrals.ts:131-144`)            | n/a (نقاط)                                                                                                              | status-guarded flip + `points + 50` increment ذري                                                      | ✅                                                                                                                                       |
| copilot/enrichment/auth-settings/whatsapp-otp/firebase-auth   | n/a                                                                                                                     | txs قصيرة داخلية                                                                                       | ✅                                                                                                                                       |

**تحليل deadlock:** ترتيب الأقفال متسق عبر المسارات — (advisory) → (inventory row) → (users row) → (orders/coupons rows) → inserts. لا مسار يأخذ users قبل inventory والعكس في مسار متقاطع؛ refund يقفل users ثم orders (لا يتعارض مع checkout الذي يدرج orders جديدة). **لا دورة قفل مكتشفة.**
**فجوة موثقة (P3):** لا يوجد retry-on-serialization-failure/40P01 تلقائي خادمياً — التصميم يعيد 409 CONCURRENCY_ERROR للعميل. مقبول تحت READ COMMITTED وبحركة الحالية الحالية؛ عند النمو يُنصح بـretry خادمي محدود لمسار checkout.

---

## 7. جودة البيانات (استعلامات قراءة فقط)

### 7.1 ✅ سلامة المال — مثالية مجدداً (17 مستخدماً، 20 قيداً)

| الفحص                                             | النتيجة                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| wallet_balance مقابل مجموع ledger لكل مستخدم      | **0 انحرافات**                                                     |
| سلسلة القيود (balance_before = آخر balance_after) | **0 انكسارات**                                                     |
| آخر balance_after = الرصيد الحالي                 | **0 فروقات**                                                       |
| بيع بلا طلب / بيع مزدوج / طلب بلا صف مخزون        | **0 / 0 / 0**                                                      |
| صحة التسلسلات (13 جدولاً serial)                  | **كلها سليمة** (wallet_topups: last=16 > max=12 — حذف موثق في r94) |

### 7.2 التشفير (V1-M7)

- `orders.delivered_password`: **5/5 صفوف بصيغة `iv:tag:ct`** (regex `^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$`) — **صفر نص صريح** ✅ (ملاحظة: الجولة-94 وثّقت أن بعضها غير قابل للفك بالمفتاح الحالي — فجوة مفاتيح قديمة، معالجة بالبوابة R93-DATA).
- `inventory.account_password`: **69/69 مشفّرة، 0 نص صريح، 0 صيغ غريبة** ✅.

### 7.3 🟠 يتامى وصفوف متقادمة

| الفحص                                  | النتيجة                                                                                     | الحكم                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **`ticket_replies` يتيمة (بلا تذكرة)** | **2 صفوف** (ردا محاكاة r94 على تذكرتين حُذفتا #2/#3)                                        | 🔴 نتيجة مباشرة للانجراف D1 (بلا FK cascade) — نفس المصير سيحدث لأي حذف تذكرة/مستخدم مستقبلاً |
| `notifications` بلا مستخدم             | 0                                                                                           | ✅                                                                                            |
| `cart_items` بلا مستخدم                | 0 (صف واحد فقط إجمالاً)                                                                     | ✅                                                                                            |
| sessions منتهية                        | **0 من 37** (أقرب انتهاء 2026-09-15)                                                        | ✅ (لا تراكم)                                                                                 |
| `admin_sessions` منتهية >24h           | **5/5** (كلها revoked=logout من r94)                                                        | 🟠 prune لا يعمل (R97-DB-01)                                                                  |
| `whatsapp_otps` >24h                   | **5/5**                                                                                     | 🟠 prune لا يعمل (R97-DB-01)                                                                  |
| `idempotency_keys`                     | صف واحد (2026-09-08)؛ **لا سياسة احتفاظ إطلاقاً** (تُحذف فقط cascade مع حذف الطلب/المستخدم) | 🟡 نمو غير محدود لكل عملية شراء بمفتاح                                                        |

### 7.4 حالة السبام/التنبيهات (V1-M8 + dedupe)

- **17 تنبيهاً** (7 low_stock + 7 no_stock + 1 system + 1 inventory_corrupt + 1 refunded_live_credentials)، كلها غير مقروءة، **0 أقدم من 14 يوماً** (markStale يعمل ضمن نافذة).
- لا ازدواج منذ الجولة-5 (dedupe_key يعمل) — لكن **صمت كامل منذ 2026-09-07 23:30** هو نفسه دليل R97-DB-01.
- توصية مستحيلة التحقق الآن: بعد إصلاح الـschedulers ستعود التنبيهات اليومية للمنتجات 13–17 (سلوك صحيح).

### 7.5 الكتالوج وبيانات المحتوى

- منتجات: **20** (2 مؤرشفة، 18 نشطة) — **1/20 فقط بصورة**، **0/20 بوصف طويل أو FAQ**، 1/20 بـcost_price → **أنبوب enrichment ما زال dormant** (كما في الجولات 5/94 — يحتاج WORKER_TIER حقيقي).
- 6 منتجات نشطة بمخزون متاح صفر (13–18؛ 18 له 3 وحدات كلها مباعة) — مصدر تنبيهات no_stock الدائمة (السلوك الصحيح المعلق بسبب R97-DB-01).

### 7.6 NOT NULL / أسرار

- `orders.discount_amount IS NULL`: 0؛ `wallet_ledger` بلا قيم NULL في الأرصدة: 0 ✅.
- 🟡 **`system_settings['auth.telegram'].bot_token`** موجود الآن كنص صريح (JSON بطول 119 يحوي توكن رقمي) — إعادة ظهور بعد توثيق r94 «أُزيل» (المشغّل فعّل دخول Telegram لاحقاً). الطبقة العرضية تحجبه عن المتصفح (بادئة فقط — auth-settings.ts:226)، لكن **نسخة DB مسربة = تزوير initData تلغرام = انتحال دخول أي مستخدم تلغرام** (bot_token هو مفتاح HMAC للتحقق). توصية: تشفيره أو نقله لمتغير بيئة.

---

## 8. Pool + Neon

| البند                                             | القيمة الفعلية                                                                                                  | الحكم                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DB_POOL_MAX`                                     | غير مضبوط في البيئة الحية (مجموعة الـ31 مفتاحاً) → **default الكود = 15 في production** (db/src/index.ts:34-36) | ✅ يطابق نية render.yaml                                                                                          |
| `DB_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` | غير مضبوطة → **default الكود: idle 30s / acquisition 10s** — render.yaml يريد **العكس** (10s/30s)               | 🟡 انجراف إعداد (يؤثر فقط على سلوك الضغط؛ acquisition 10s كافٍ لأن Neon wake ≤ ~3s)                               |
| `statement_timeout`                               | 15s لكل اتصال (R4) + TCP keepalives (30s) + channel_binding=require مفعّل من الـURL                             | ✅ ممتاز                                                                                                          |
| حد اتصالات Neon                                   | `max_connections=112` على الـcompute؛ الـpool (15) ≪ الحد، عبر pooler endpoint                                  | ✅ متّسع كبير لمثيل واحد                                                                                          |
| **healthz**                                       | `/api/healthz` **ثابت JSON — لا يلمس DB إطلاقاً** (health.ts:460-463)                                           | 🟡 Render health-check لا يوقظ Neon؛ keep-alive الداخلي (\*/10min) يping `/api/healthz` (بلا DB) + بوابة OpenWA   |
| **Cold start**                                    | Neon autosuspend → أول استعلام بعد الخمول يدفع wake (~0.3–2s)                                                   | **مقايضة موثقة بوعي** (توفير حصة compute-hours — cron.ts:160-168)؛ مع R97-DB-01 لا يوجد أي نبض دوري يلمس DB أصلاً |

---

## 9. الـMigrations (migrate.ts + boot-migrations.ts)

- **Idempotency:** كل العبارات محمية (IF NOT EXISTS / DO-block probes / count-probe-before-DDL)؛ **steady-state = صفر DDL** (تحقق مرحلة users وextensions).
- **الحماية:** بوابة قابلية الكتابة (`pg_is_in_recovery` + `transaction_read_only`، انتظار حتى 120s) → قفل Redis NX EX 300s (**fail-open** بلا Redis — انظر التناقض مع scheduler في R97-DB-01) → تصنيف أخطاء (idempotent/transient/critical) مع retry 5s/15s/45s للعابر → **re-throw** والإقلاع يجُهض في production (P0-4) — لا نشر على schema مبتور.
- **V1-M7:** يعمل كل إقلاع كـprobe-guarded loop (ليس markers) — لا شيء ليشغّل مرتين (الحارس `NOT LIKE '%:%:%'` + `isEncrypted`).
- **V1-M8:** `consolidateStockAlertSpam()` idempotent (no-op بعد التوثيق).
- **V1-M12/M13:** DO-block existence probes — لا يمكن أن تُنشئ شيئاً مرتين؛ مطابقة حرفية مع schema TS (تحقق حي).
- **V1-M9/M10:** probes → تنبيه بدل فشل؛ `chk_ledger_amount_nonzero` حي والقديم `chk_ledger_amount_pos` **اختفى فعلاً** ✅.
- 🟡 **R97-DB-08:** `drizzle-kit check` **لا يعمل في هذه البيئة** — يفسّر الـURL ويطلب «AWS Data API driver» params (خروج مبكر رغم exit=0) — بوابة الانجراف المعلنة غير قابلة للتشغيل كما هي؛ جولة-5 تحققت عبر `generate` يدوياً بدلاً منها.

---

## 10. مهام الاحتفاظ (Retention) — الدليل الحي

| المهمة                                 | الجدولة             | boot one-shot؟  | دليل التنفيذ الحي                                          |
| -------------------------------------- | ------------------- | --------------- | ---------------------------------------------------------- |
| session-prune (14d/انتهاء)             | 05:00 يومياً        | ✅              | 0 جلسات منتهية — لا تراكم (غير حاسم)                       |
| alert retention (stale 14d / read 30d) | 00:00               | ✅              | لا صف >14d — غير حاسم الآن (يصبح حاسماً بعد 2026-09-21)    |
| auth-activity 90d                      | 04:30               | ✅              | أقدم صف 2026-08-25 — داخل النافذة                          |
| risk-events 90d                        | 03:30               | ✅              | الجدول فارغ                                                |
| **admin-sessions prune**               | 05:00               | ❌ **cron فقط** | **5 صفوف منتهية >48h — لم تُنظف**                          |
| **whatsapp_otps prune**                | كل ساعة :15         | ❌ **cron فقط** | **5 صفوف >24h — لم تُنظف**                                 |
| **idempotency_keys retention**         | **لا يوجد إطلاقاً** | ❌              | صف واحد — نمو غير محدود                                    |
| TOTP advisory                          | 00:05               | ✅              | الاستشاري #340 حي (ahmadmedo ما زال بلا TOTP — بنود مشغّل) |

انظر R97-DB-01: حتى المهام ذات one-shots لم تترك أثراً منذ ~2026-09-08، لكن الفجوة القابلة للإثبات هي للاثنين cron-only.

---

## 11. قائمة الإصلاحات ذات الأولوية

| #   | الأولوية  | الإصلاح                                                                                                                                                                                                                                                                                                | الجهد              |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1   | 🔴 **P1** | **إعادة تشغيل طبقة الـschedulers:** تحقق من `REDIS_URL` في بيئة Render (السجلات: `"[redis] REDIS_URL is missing in production"` / `"[scheduler] Redis unavailable at boot"`). أعده (أو عطّل الويب بوعي + worker حقيقي). بعدها تحقق الحي: تنبيهات no_stock تظهر خلال 60s، صفوف OTP/admin_sessions تُنظف | سطر env + redeploy |
| 2   | 🟠 **P2** | **إغلاق انجراف ticket_replies:** أضف في `migrate.ts` (القائمة عند :1244) `ALTER TABLE ticket_replies ADD CONSTRAINT fk_replies_ticket … ON DELETE CASCADE` + `CREATE INDEX IF NOT EXISTS idx_replies_ticket`؛ ونظّف الـصفين اليتيمين يدوياً                                                            | migration صغيرة    |
| 3   | 🟠 **P2** | **تغطية one-shot للـprune الناقص:** أضف `pruneStaleAdminSessions` + `pruneExpiredOtps` إلى fireOneShot في web-scheduler.ts:191-199 (idempotent) — تحصين ضد أي توقف مستقبلي للـcron                                                                                                                     | سطران              |
| 4   | 🟠 **P2** | **retention لـidempotency_keys** (مثلاً 30d في خانة 05:00) + مرآة `uniq_wallet_topups_payment_reference` و`idx_users_phone_trgm` و`idx_forecasts_at_risk_runout` وFKs cart_items في schema TS (حماية من drizzle push يُسقط حرز مال)                                                                    | schema + سطر cron  |
| 5   | 🟠 **P2** | `orders.discount_amount` → أضف `.notNull()` في schema (يجعل generate صفر-انجراف ويمنع اقتراح DROP NOT NULL)                                                                                                                                                                                            | سطر                |
| 6   | 🟡 **P3** | تشفير/نقل `auth.telegram.bot_token` من system_settings                                                                                                                                                                                                                                                 | صغير               |
| 7   | 🟡 **P3** | تنظيف الفهارس المزدوجة بنيوياً (users firebase ×2، referral الجزئي، risk_rules name) + LIMIT على قائمة الكوبونات                                                                                                                                                                                       | صغير               |
| 8   | 🟡 **P3** | توحيد DB_IDLE/CONNECTION_TIMEOUT بين render.yaml والبيئة الحية (أو حذفها من yaml) + إصلاح/استبدال بوابة drizzle-kit check                                                                                                                                                                              | صغير               |

---

## 12. رصيد مؤكد سليم (لمنع إعادة التدقيق في الجولات القادمة)

سلامة المال 100% (0/0/0/0) — V1-M7 كامل (5/5 iv:tag:ct) — inventory 69/69 مشفرة — V1-M8 + dedupe_key مستقران (321→17 بلا تكرار) — إغلاق انجراف r94 لـidempotency_keys/admin_sessions مؤكد حيًّا — V1-M9/V10 قيود المال حية — التسلسلات 13/13 — لا يتامى notifications/cart — transactions المال كلها CAS/ FOR UPDATE SKIP LOCKED / advisory locks داخل نفس الـtx — لا N+1 في المسارات الساخنة — كل الاستعلامات الحارة sub-ms بخطط صحيحة — pool+statement_timeout+keepalives+channel_binding سليمة — migrations idempotent ببوابة كتابة وتصنيف أخطاء وre-throw.

## 13. بنود مشغّل (خارج الكود)

- القراران المعلقان للشحن: **#9 (u6 = 100 د.ل) و#10 (u13 = 5 د.ل)** — منذ 9/2 و9/5.
- مستخدم حقيقي (id 27) بتجربتَي دعم مفتوحتين (2026-09-10) تحتاجان رداً.
- TOTP لـahmadmedo ما زال معطلاً (استشاري الدرج سيذكّر أسبوعياً — بعد إصلاح الـschedulers).
- إعادة رفع مخزون المنتجات 13–18 أو أرشفتها (لا مبيعات أصلاً).
- تفعيل أنبوب enrichment (الصور 1/20) يتطلب worker حقيقياً.

---

_أُعدّ هذا التقرير بجلسات قراءة فقط (SELECT/EXPLAIN). لم تُكتب أي صفوف ولم يُعدَّل أي ملف مصدر ولم يُعمل أي commit._
