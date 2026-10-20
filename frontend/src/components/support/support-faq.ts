import type { FaqItem } from "@/lib/seo-builders";
import { formatCurrency } from "@/lib/utils";
import { WELCOME_BONUS_LYD } from "@/lib/referral-policy";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the FAQ content data. One source feeds BOTH surfaces Google's parity
// rule binds together: the visible accordion (FaqSection.tsx renders
// every Q&A) and the FAQPage JSON-LD the page's useSeo block builds
// (buildFaqLd(SUPPORT_FAQ)) — pinned by support-faq-copy.test.tsx and
// seo-money-pages-r120.test.tsx at the rendered level. Pure data: no
// React, no lucide, importable by any lane.

/**
 * SEO FAQ — answers questions real users ask before they sign up.
 *
 * IMPORTANT: every item here is grounded in actual product behaviour
 * (wallet ledger, topup approvals, instant credentials delivery, the
 * 5 LYD welcome bonus on the referred user's first APPROVED topup —
 * R115 policy B, etc.). Do NOT fabricate
 * answers — Google can downgrade FAQ rich-results that don't match
 * the rendered page content. Update both the Q&A objects AND any UI
 * copy that asserts the same fact when policies change.
 *
 * Schema rules (from Google):
 *   - Q&A must also be visible on the page (not just in JSON-LD).
 *   - Answers must be the publisher's, not the user's.
 *   - Don't mark up advertising content as FAQ.
 */
export const SUPPORT_FAQ: FaqItem[] = [
  {
    question: "كيف أشتري اشتراكاً عبر SubNation؟",
    answer:
      "اختر المنتج من المتجر، تأكد من رصيد المحفظة، ثم اضغط «اشترِ الآن». سيتم خصم المبلغ من محفظتك فوراً وستصلك بيانات الاشتراك في صفحة الطلب وعبر الإشعارات.",
  },
  {
    question: "ما طرق الدفع المتاحة؟",
    answer:
      "يتم الشراء من رصيد محفظتك داخل SubNation. يمكنك شحن المحفظة بالدينار الليبي عبر طلبات الشحن داخل صفحة المحفظة، ثم يتم اعتماد الشحن من قِبَل الإدارة قبل توفر الرصيد للشراء.",
  },
  {
    question: "متى أستلم بيانات الاشتراك بعد الشراء؟",
    answer:
      "التسليم فوري في أغلب الحالات. إذا كان المنتج يتطلب تجهيز يدوي ستُحدَّد مدة الانتظار في صفحة الطلب وتصلك بيانات الاشتراك فور جهوزيته.",
  },
  {
    question: "هل يمكنني استرداد المبلغ إذا واجهت مشكلة؟",
    answer:
      "نعم. إذا لم يصلك الاشتراك أو واجهتك مشكلة في تفعيل الحساب، تواصل مع الدعم خلال 24 ساعة من الشراء وسنُرجع المبلغ إلى محفظتك بعد التحقق. الاشتراكات المسلَّمة والمستخدَمة لا تُسترَد.",
  },
  {
    question: "كم تستغرق الموافقة على شحن المحفظة؟",
    answer:
      "عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل. ستظهر حالة الطلب في صفحة المحفظة، وتصلك إشعارات بالاعتماد أو الرفض.",
  },
  {
    /* R123-E4b (P1): the platform is passwordless — Google / Telegram /
       WhatsApp OTP; there is NO email login. The old answer claimed
       «الدخول عبر البريد الإلكتروني وGoogle وTelegram» while contradicting
       itself with «لا حاجة لكلمات مرور تقليدية», omitted WhatsApp OTP
       entirely, and contradicted terms.tsx §3/§4. The Q&A object feeds
       BOTH the visible FAQ and the FAQPage JSON-LD (buildFaqLd below). */
    question: "كيف أسجّل الدخول بدون كلمة مرور؟",
    answer:
      "الدخول عبر Google أو Telegram أو رمز تحقق يُرسل إلى واتساب — لا حاجة لكلمة مرور. استخدم الطريقة نفسها التي سجّلت بها أصلاً.",
  },
  {
    question: "هل بياناتي الشخصية محمية؟",
    answer:
      "نعم. جميع البيانات تُرسَل عبر اتصال مشفّر (HTTPS)، ولا نشارك بياناتك مع أطراف ثالثة. للاطلاع على التفاصيل راجع صفحة سياسة الخصوصية.",
  },
  {
    question: "هل يمكنني مشاركة حساب الاشتراك مع شخص آخر؟",
    answer:
      "تخضع المشاركة لشروط الخدمة الأصلية لكل منصة (Netflix، Spotify، …). نحن لا نمنع المشاركة لكن أي قيود من جانب المنصة الأصلية تظل سارية ولا نتحمّل مسؤوليتها.",
  },
  {
    question: "هل أحصل على مكافأة عند دعوة أصدقائي؟",
    answer: `نعم. عندما يعتمد فريقنا أول شحن لصديقٍ انضم عبر رمز إحالتك، تحصل أنت على نقاط الولاء قابلة للتحويل لرصيد، ويحصل صديقك على مكافأة ترحيب ${formatCurrency(WELCOME_BONUS_LYD)} تُضاف لمحفظته في الوقت نفسه.`,
    /* R177: the welcome-bonus figure rides the shared policy module
       (mirrors backend loyalty-policy.ts) — a policy change now
       re-renders this copy from one address. */
  },
  {
    question: "كيف أتواصل مع الدعم؟",
    answer:
      "افتح تذكرة دعم جديدة من هذه الصفحة باختيار التصنيف المناسب وإرفاق التفاصيل. يصلك الرد عبر الإشعارات وداخل التذكرة.",
  },
  {
    question: "هل المتجر متاح خارج ليبيا؟",
    answer:
      "SubNation مصمَّم لمستخدمي ليبيا والدفع بالدينار الليبي. يمكن لأي شخص تصفح المنتجات، لكن قد يتطلب الشراء وسيلة شحن متاحة محلياً.",
  },
];
