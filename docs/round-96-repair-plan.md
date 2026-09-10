# الجولة 96 — خطة الإصلاح الشاملة (تركيز نسخة الهاتف)

التاريخ: 2026-09-11 · المدخلات: 6 تقارير تفتيش (docs/inspection-r96/) — **123 نتيجة: 2 P0 · 30 P1 · 47 P2 · 44 P3**

المنهجية: جولة ضخمة من الفحوصات (6 وكلاء تشخيص متوازيين) → تقارير → هذه الخطة → تنفيذ عبر 7 وكلاء إصلاح بملفّات غير متقاطعة → تحقق كامل (typecheck/lint/اختبارات/بناء) → دفع ونشر.

## موجز التشخيص

| التقرير                  | P0  | P1  | P2  | P3  | أهم نتيجة                                                            |
| ------------------------ | --- | --- | --- | --- | -------------------------------------------------------------------- |
| mobile-layout            | 1   | 7   | 6   | 8   | شريط التنقل المسجَّل يقص أيقونة السلة عند 320-360px                  |
| mobile-touch-forms       | 0   | 7   | 12  | 7   | نسخ بيانات التسليم يفشل بصمت + كلمة مرور غير قابلة للتحديد           |
| mobile-performance-pwa   | 0   | 2   | 7   | 11  | AuthGate شلال تسلسلي (+0.6-1.2s LCP) + sourcemaps 9.4MB منشورة       |
| mobile-journeys-whatsapp | 1   | 6   | 5   | 4   | **سباق "Waiting for this message" مؤكد في الكود** (بلا بوابة settle) |
| admin-backend-mobile     | 0   | 3   | 7   | 8   | الشحن بلا idempotency + السوكت يستسلم بعد 5 محاولات                  |
| mobile-rtl-a11y          | 0   | 5   | 10  | 6   | letter-spacing على العربي + تباين 2.07:1 في الوضع الفاتح             |

## موجات الإصلاح (تنفيذ بملفّات حصرية لكل وكيل — لا تقاطع تعديلات)

### F1 — قناة WhatsApp الخلفية (P0-2 + المال الخلفي)

openwa.service.ts · whatsapp-otp.service.ts · routes/auth-whatsapp.ts · routes/auth-settings.ts · lib/crypto.ts · routes/wallet.ts · routes/admin/alerts.ts · jobs/cron.ts · app.ts · index.ts

1. بوابة settle بعد الربط (WHATSAPP_OTP_SETTLE_MS=45s، readySince في الذاكرة+Redis، reason=session_settling، انتظار محدود ≤20s ثم 503+Retry-After)
2. حلقة warm-up ذاتية لرقم المشغّل كل 6 س (WHATSAPP_OTP_OPERATOR_E164) قبل dispatchReady
3. إرسال بـ 3 محاولات (backoff 1.5s/4s) للشبكة/5xx فقط + إعادة ensureSession بين المحاولات
4. readiness صادقة: settling/readyInSec، والواجهة ترى whatsapp_status="settling"
5. تطبيع +218/00218/218 في normalizeLibyanPhone
6. idempotency على POST /topups (routeKey wallet.topups.create)
7. /admin/alerts/new?since → WHERE id > since في SQL
8. ربط pruneExpiredOtps بمهمة الاحتفاظ 00:00 + إدراج OTP بإعادة محاولة واحدة
9. authLimiter: سقف مستقل أرفع لـ whatsapp/start (CGNAT) + requestTimeout صريح للخادم

### F2 — واجهة WhatsApp OTP (الواجهة)

WhatsAppPhoneSignIn.tsx · use-public-auth-providers.ts

1. زر «إعادة الإرسال» على خطوة الرمز (يحترم التهدئة، يحفظ الرقم)
2. حالة settling: رسالة صادقة + إعادة محاولة تلقائية (≤2) بعد retry_after_sec
3. تلميح settling تحت الزر من whatsapp_status
4. نصوص 16px (إلغاء تقريب iOS) على الهاتف والرمز
5. تطبيع الرقم عميلًا (+218/00218) + errors عبر getErrorMessage
6. توحيد «رمز التحقق» + «(60 ث)» + aria-label بأرقام لاتينية + روابط 44px + enterKeyHint

### F3 — نواة التطبيق: صمود الشبكة + الأداء

App.tsx · lib/socket.ts · SocketInitializer.tsx · lib/user-session.ts (جديد) · custom-fetch.ts

1. السوكت لا يستسلم (Attempts=∞, delayMax=10s) + إحياء عند online/visibility
2. resync مرة واحدة عند عودة الاتصال: إبطال عائلات المال (orders/wallet/topups/me)
3. مهلة 20s افتراضية في customFetch (AbortSignal.any مع signal المتصل)
4. معالج 401 للمتجر (user-session.ts بنمط admin-session: توست مرة واحدة + setToken(null) + /login?redirect=)
5. توازي AuthGate: prefetch لchunk الرئيسية + fetch(/api/products) بالتوازي مع probe (إزالة RTTs التسلسلية)
6. بوابة السوكت بالمستخدم فقط (الضيوف لا يحملون 16KBgz)

### F4 — مسارات المال في الواجهة

checkout.tsx · product.tsx · cart.tsx · ProductCard.tsx · route-skeleton.tsx · order-detail.tsx

1. مفاتيح idempotency مستقرة لكل وحدة (sessionStorage، إعادة استخدام عند إعادة المحاولة، حذف عند الحسم)
2. Idempotency-Key للشراء المفرد من صفحة المنتج (لكل نية شراء)
3. توحيد نسخ بيانات الاعتماد على CopyButton المشترك (فشل معلن) + قيمة قابلة للتحديد break-all (لا زر يحبس النص) + أزرار 44px
4. سلة: خطوات 44px + مسافة عن الحذف + useConfirm للإفراغ + توست «تراجع» لحذف السطر + تخطيط 320px
5. CTA تأكيد الطلب: يلتف بدل overflow عند الكوبون + X البانر 44px + كوبون autoComplete=off/16px
6. قفل double-tap للإضافة للسلة (500ms) + badge الفئة ≥10px + skeleton يتضمن CTA الجوال (CLS)
7. order-detail: tracking-wider يُزال + أيقونة النسخ مرئية باللمس + dir=auto للتفاصيل الحرة + redirect لنية الشراء

### F5 — هيكل الواجهة (الشريط العلوي/السفلي/الحوارات)

Navbar.tsx · NotificationBell.tsx · MobileNav.tsx · app-dialog.tsx · dialog.tsx · alert-dialog.tsx · Footer.tsx · index.html · home.tsx · FlashSaleBanner.tsx

1. **P0**: رقاقة الرصيد تختفي تحت sm (الرصيد في المحفظة/البطل) → السلة تظهر دائمًا عند 320px + تقليل الفجوات
2. safe-area أعلى الشريط (PWA تحت النوتش) + panel الإشعارات maxHeight=calc(100dvh-…) وoffset مقاس
3. MobileNav: خلفية صلبة (إلغاء backdrop-blur-3xl = GPU) + يختفي عند فتح الكيبورد (visualViewport)
4. AppDialog: pb-safe للفوتر + max-h-dvh + scrollIntoView عند focus
5. dialog/alert-dialog القديمة: هوامش+استدارة+حد أقصى ارتفاع مع تمرير + أزرار 44px
6. viewport: interactive-widget=resizes-content
7. home: بحث/ترتيب 16px (إلغاء zoom) + إيقاف حركات البطل خارج الشاشة + lang=en لشارات الماركات
8. توحيد الشارات (9+/الزاوية) + Footer flex-wrap + مساحة ضيف للشريط اللاصق

### F6 — نماذج المحفظة/الدعم/الملف الشخصي

wallet.tsx · support.tsx · profile.tsx · referrals.tsx · register.tsx · TopupWaitingModal.tsx

1. Idempotency-Key لإرسال الشحن + inputMode=decimal للمبلغ (كيبورد عشري) + autoComplete=off
2. تسميات مرتبطة (id+htmlFor) للمبلغ/هاتف المرسل/الحساب + aria-describedby للأخطاء
3. رقاقات 44px (هواتف محفوظة/مبالغ جاهزة)
4. إزالة شفافيات نصوص الحالة (/75 /80 → كاملة) في wallet/referrals/register/Topup
5. TopupWaitingModal: aria-live للاعتماد/الرفض (role=status/alert)
6. support: تسميات مرتبطة + maxLength + أزرار 44px + enterKeyHint
7. profile: useConfirm لفصل المزوّد + زر 44px بنص + إزالة tracking-wider

### F7 — الطباعة العربية/الأرقام/الأخطاء + الأدمن على الجوال

index.css · lib/utils.ts · lib/errors.ts · admin/\* (login, settings, orders, users, products, risk, risk-event, security, layout, pricing, promotions) · InventoryUploadDialog

1. حارس letter-spacing موسّع (tracking-wide/wider/widest → 0) + إزالة −0.005em من عنوان التوست
2. line-height: body 1.7 · العناوين 1.3 · label/dialogTitle: leading-snug
3. زر إغلاق التوست مرئي باللمس (hover:none → opacity 1 + 28px)
4. تثبيت -u-nu-latn لكل تواريخ ar-LY (مساعد formatDateAr)
5. getErrorMessage: كل أكواد HTTP + تعريب مسار whatsapp
6. أدمن: TOTP inputMode=numeric · بيانات تسليم مقنّعة+نسخ في بطاقات الجوال · محرر مخزون 44px · تأكيد الأرشفة · clamp للنقاط · أخطاء 2FA inline · استقصاء المخاطر لا يعمل بالخلفية · scope=col للجداول · أزرار topbar أ larger · إخفاء تلميحات kbd على اللمس

### الوكيل الرئيسي (أنا) — إعدادات البناء

vite.config.ts · public/manifest.json: حذف sourcemaps بعد الرفع + قياس gzip صحيح لبوابة الميزانية + إزالة تكرارات precache + TTL الكتالوج 7 أيام + manifest.id + تحديث SW بتوست

## ما لن يُنفَّذ في هذه الجولة (موثّق بأمانة)

- F-2 (أنبوب صور srcset/CDN): معطل حتى تفعيل enrichment (0/18 صورة اليوم) — يُصمَّم قبل التفعيل
- M10 (اعتمادات عند الطلب في قوائم الأدمن): تغيير API أكبر يُجدول منفصلًا
- F-6 (Sentry Replay على الجوال): قرار تشغيلي يوثَّق للمشغّل
- الواقع الافتراضي/PWA screenshots: يحتاج لقطات حقيقية (موثّق)

## بوابات القبول

typecheck نظيف · lint 0 أخطاء · كل الاختبارات خضراء (884 خلفي + 274 واجهة + الجديد) · بناء كامل · لا انحدار في عقود API
