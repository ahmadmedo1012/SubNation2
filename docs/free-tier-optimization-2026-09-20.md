# SubNation — تحسين التشغيل على البنية المجانية + تقوية الإنتاج
**التاريخ:** 2026-09-20 · **المرحلة:** Free Infrastructure Optimization & Production Hardening

---

## ١) ما الذي كان يستنزف الموارد المجانية؟

| المصدر | آلية الاستنزاف | التكرار |
|---|---|---|
| **GitHub Actions** (مستودع `ahmadmedo1012/keep-alive`) | workflow `keep-warm.yml` ي ping `subnation.ly/api/healthz` + `openwa-gateway…/healthz` | **كل ٥ دقائق** |
| **Render — الباكند** (jobs/cron.ts، المهمة ٨) | self-ping عبر APP_URL إلى `/api/healthz` + ping مباشر لبوابة OpenWA | كل ١٠ دقائق |
| **Render — OpenWA** (src/index.ts) | self-ping إلى `RENDER_EXTERNAL_URL/healthz` | كل ٤ دقائق |
| **Neon** (flashSaleWatcher) | استعلام UPDATE/SELECT للجدول | كل ٥ دقائق |
| **Neon** (stockWatcher / couponWatcher / تنظيف OTP :15 / copilot reaper :45) | استعلامات دورية | كل ٣٠–٦٠ دقيقة |
| **OpenWA** (whatsapp-watch) | probe جاهزية عبر HTTP كل ٦٠ ثانية → البوابة لا تنام أبدًا ما دام الباكند مستيقظًا | كل ٦٠ ثانية |
| **OpenWA + WhatsApp** (warmup loop 96-F1) | رسالة self-check كل ٦ ساعات (كان هدفها المعلن إبقاء «البوابة دافئة») | كل ٦ ساعات |
| **بيئة العمل المحلية** | `scripts/keepalive.sh` — curl كل ٢٤٠ ثانية | مستمر |

**النتيجة الصافية قبل المرحلة:** الخدمات الثلاث (Render web + OpenWA + Neon) تعمل ٢٤/٧ على خطط مجانية رغم غياب الزوار الحقيقيين — وهو ما استنفد حصص الفاتورة وأدى لتعليق الخدمات (`suspenders: ['billing']`).

---

## ٢) ما الذي تغيّر

### أ — حُذف نهائيًا (استنزاف صناعي محض)
1. **workflow `keep-warm.yml`** من مستودع keep-alive — حُذف + الملف `README.md` يوثّق التقاعد (commit محلي جاهز للدفع؛ يُعطَّل أيضًا فورًا من GitHub UI عبر زر Disable workflow).
2. **المهمة ٨ في cron.ts** (keep-alive self-ping + ping البوابة) — حُذفت مع تعليق يشرح السبب.
3. **المهمة ٢** (heartbeat ساعي بلا وظيفة) — حُذفت.
4. **self-ping في OpenWA** (index.ts) — حُذف. لم يُمس إطلاقًا: persistence، استعادة الجلسات عند الإقلاع، reconnect، pairing، delivery-log، rate limits، graceful shutdown، معالجات OTP.
5. **`scripts/keepalive.sh` المحلي + سجله** — حُذفا.

### ب — تحوّل إلى On-Demand / Event-Driven (وظيفة حقيقية بلا مؤقّت)
| الوظيفة | قبل | بعد |
|---|---|---|
| flash-sale expiry | مؤقّت ٥ دقائق | boot catch-up + قراءة `/api/flash-sale` العامة (خانق ١٠ د) + فتح لوحة العروض (خانق ١ د) |
| coupon expiry | مؤقّت ساعي | boot catch-up + `POST /coupons/validate` (خانق ١٥ د) + قائمة كوبونات الأدمن (خانق ١ د) |
| stock alerts | مؤقّت ٣٠ دقيقة | boot catch-up + بعد الشراء الناجح / بعد الاسترجاع / بعد كتابة مخزون من الأدمن (خانق ١٠ د) |
| whatsapp_otps prune | cron :15 ساعيًا | boot catch-up + بداية `startOtp` (خانق ٦٠ د) |
| copilot reaper | cron :45 ساعيًا | boot catch-up + سطح Copilot للأدمن (خانق ٦٠ د) |
| **whatsapp-watch** (إنذار موت القناة) | probe كل ٦٠ ث | **مراقَبة بالملاحظة**: كل probe جاهزية حقيقي (صفحة الدخول/لوحة الأدمن) + كل محاولة OTP فاشلة تغذّي آلة الحالة نفسها (نفس عتبة الـ١٥ دقيقة ونفس مفاتيح dedupe) — بلا أي مؤقّت |
| **WhatsApp warm-up** (96-F1) | حلقة كل ٦ ساعات | **intent-driven**: self-check لمرة واحدة لكل pairing epoch، جدولته أول ملاحظة `ready` حقيقية (طلب OTP أو probe) |

الخانقات كلها عبر وحدة جديدة: `backend/src/lib/opportunistic.ts` — fire-and-forget، لا تؤخر الطلب أبدًا، لا ترمي أبدًا، بلا أي timer.

### ج — تحسينات Cold Start والـUX
- **boot one-shots متسلسلة** بدلًا من ٨ مهام متزامنة تضرب Neon المستيقظ للتو (§25 — منع storm الاستعلامات عند الإقلاع). الزمن من بدء الجداول إلى فتح بوابة المرور: **٣٤ مللي ثانية**.
- **customFetch (الواجهة)**: إعادة محاولة واعية بالإقلاع البارد — عند 503 بوابة الإقلاع (`status:"starting"` أو رسالة «الخدمة قيد التشغيل») يعيد المحاولة تلقائيًا (1.5s → 3s → 5s…) بميزانية مخصصة ٤٥ ثانية **تُفعَّل مرة واحدة فقط**؛ إعادة المحاولة آمنة حتى لـPOST لأن البوابة ترفض الطلب قبل توجيهه. رسائل 503 التجارية (صيانة المخزون مثلًا) **لا** يُعاد إرسالها أبدًا — تغطية اختبارية ٥ حالات.
- **بوابة الإقلاع المبكر للمنفذ** (موجودة سابقًا): المنفذ يفتح بعد ~١٢ مللي ثانية ويرد 503 «starting» حتى اكتمال الترحيلات — Render يرى «يقلع» لا «ميت».
- **healthz خفيف** (موجود): `{"status":"ok"}` بلا DB/Redis/خارجي — ١١ مللي ثانية مقاسة.
- سلوك WhatsApp عند التسوية (whatsapp_settling) يبقى كما هو: رسالة انتظار صادقة + auto-retry مرتين + زر يدوي (96-F2).

### د — render.yaml (Blueprint)
- `plan: starter` → **`plan: free`** للخدمة الرئيسية.
- **حُذف خدمة `subnation-worker` (starter مدفوعة)** كليًا من الـblueprint — `Apply Blueprint` لم يعد قادرًا على إنشاء أي خدمة مدفوعة. النظام لا يعتمد على worker منفصل إطلاقًا.
- Redis تبقى free (بنية fallback موجودة: كل شيء يعمل بدونها — تم التحقق محليًا عبر PG lease).
- `DB_POOL_MAX`: 15 → **8** (Neon free = 0.25 CU).
- تعليقات keep-alive القديمة استُبدلت بتوثيق النموذج الجديد.

### هـ — ما بقي كما هو (ولماذا)
- **الترحيلات عند الإقلاع** — بوابة أمان مقصودة (لا تُلمس بحسب التعليمات).
- **cron اليومي** (الاحتفاظ 00:00/00:05/02:15/03:30/03:35/03:50/04:00/04:30/05:00) — منخفض التردد فعلًا + idempotent + boot catch-up.
- **مقيّم الإنذارات كل ٦٠ ث** — يقرأ prom-client + Redis فقطًا (لا DB ولا خارجي)؛ يعمل فقط والعملية حية.
- **heartbeat كل ١٥ ث** — Redis فقط (لا ينام)، يغذي إنذار worker_heartbeat_missing.
- **Caching العام للكتالوج** (s-maxage=60 + SWR=300، flash-sale 30/60) — من مرحلة الكتالوج، كما هو؛ البيانات الشخصية `no-store` كما هي.
- **React Query**: staleTime 60s، refetchOnWindowFocus/Reconnect = false — كما هو (كان محسّنًا).
- **Socket.IO**: lazy dynamic import + autoConnect:false + قطع عند الخروج — كما هو.
- **Vercel**: SPA + rewrite `/api/*` → Render (vercel.json سليم) — كما هو.
- **Sentry**: عينات 0.1 كما هي.

---

## ٣) المعمارية النهائية

```
Cloudflare  → DNS / Proxy / توصيل
Vercel      → Frontend (SPA/JS/CSS/صور) + rewrite /api/* 
Render Free → Backend API (ينام بعد ~15 د خمول — مقبول)
Neon Free   → قاعدة الحقيقة (تنام بعد ~5 د بلا استعلام)
OpenWA Free → بوابة WhatsApp عند الحاجة (استعادة جلسة عند الإقلاع)
GitHub      → CI فقط (لا pings)
```

**القاعدة الجديدة: صفر حركة صناعية. كل عمل خلفي يحدث بسبب طلب حقيقي أو حدث إقلاع.**

---

## ٤) الأداء (قياس فعلي)

| المقياس | قبل | بعد |
|---|---|---|
| Cold start (استماع → جاهز، Neon بارد) | ~24.9 ث (سجل round-93، نفس مسار الترحيل) | **~32.5–33.3 ث** مقاسة محليًا×2 (الفرق = زمن إيقاظ Neon نفسه؛ الترحيلات أمان مقصود) |
| فتح المنفذ منذ بدء العملية | ~12 مللي (البوابة المبكرة، سابقًا) | ~12 مللي (كما هو) |
| الجداول → فتح المرور (بعد الترحيل) | فوري مع one-shots **متزامنة** | **34 مللي** (one-shots متسلسلة، لا تحجب) |
| `GET /api/healthz` | خفيف | **11 مللي ثانية** |
| `GET /api/products` (45 منتجًا/263 باقة) بعد الإقلاع | — | أول طلب **1.86 ث** (خزائن باردة) → **0.65 ث** بعد الإحماء |
| ثبات الظهور أثناء الإقلاع | 503 فوري ← بطاقة خطأ | 503 ← **إعادة محاولة تلقائية شفافة** حتى 45 ث |

> ملاحظة صدق: أرقام «قبل» للإقلاع مأخوذة من سجل round-93 (نفس DB ونفس مسار الترحيل) لأن الخدمات معلّقة حاليًا للفوترة ولا يمكن قياس A/B حي. المكسب الحقيقي ليس تقصير الإقلاع (زمن Neon خارج سيطرتنا) بل: **معدل حدوثه أقل بكثير** (الخدمة تنام بدل ٢٤/٧) + **تجربة الإقلاع شفافة** للمستخدم بدل بطاقة خطأ.

---

## ٥) التحقق

| الفحص | النتيجة |
|---|---|
| Backend typecheck | 0 أخطاء |
| Shared client typecheck | 0 أخطاء |
| Frontend typecheck | 0 أخطاء |
| **اختبارات الباكند** | **119 ملفًا / 1080 ناجحًا** (+5 todo) |
| **اختبارات الواجهة** | **67 ملفًا / 487 ناجحًا** (منها 5 جديدة لـcold-start retry) |
| **اختبارات openwa** | **65/65 ناجحة** + بناء tsc سليم |
| Build (frontend) | نجاح (PWA precache 12 entries) |
| Lint (الملفات المعدلة) | 0 أخطاء، 0 تحذيرات جديدة (التحذيرات الأربع المتبقية موجودة على HEAD قبل التعديل — موثقة) |
| Boot فعلي محلي على Neon الحي | إقلاع كامل + healthz + catalog + إغلاق نظيف |

### سلامة الـFree Tier
```
Artificial keep-alive   = 0  (GitHub workflow + self-pings + local script — كلها محذوفة)
Paid services           = 0  (worker حُذف من الـblueprint؛ web=free؛ redis=free)
External monitoring     = 0  (لا uptime/ping service إطلاقًا)
Unnecessary polling     = 0  (صفر مؤقّات دورية تلمس DB/OpenWA؛ المتبقي: cron يومي + مقيّم in-memory)
```

---

## ٦) خطوات مطلوبة من المشغّل (لا يمكن تنفيذها من هنا)

1. **دفع مستودع keep-alive**: `cd keep-alive && git push origin main` (commit `da1aab0` جاهز) — أو من واجهة GitHub: Actions → Keep-warm pings → **Disable workflow** ثم حذفه. هذا **إلزامي** لإيقاف الـpings الخارجية — هي الوحيدة التي لا تُوقف من كود SubNation.
2. **دفع مستودع openwa**: `git push origin master` (commit `178cc23` جاهز) — ثم redeploy لخدمة openwa-gateway على Render.
3. **دفع SubNation2**: commit جاهز على main → CI أخضر → deploy عبر Render.
4. **Render Dashboard**: تحويل `subnation` إلى **Instance Type = Free** + حذف خدمة `subnation-worker` إن كانت منشأة (الـblueprint الجديد لن يعيد إنشاءها)، وحذف أي cron/Env عن keep-alive إن وجد. **استئناف الخدمات المعلّقة** (الفوترة).
5. بعد الاستئناف: اختبار سيناريو الإيقاظ اليدوي (§36): انتظار >15 د بلا زيارات → أول طلب → catalog يعمل → دخول يعمل → WhatsApp: طلب OTP → إيقاظ البوابة → استعادة الجلسة → وصول الرمز.

**لا يوجد أي بديل مدفوع ولا خدعة تحايل على الحصص — تحسين حقيقي فقط.**
