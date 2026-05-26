/**
 * Category landing-page metadata — single source of truth for both
 * the frontend `/category/:slug` page and the backend sitemap.
 *
 * Each entry is intentionally unique:
 *   - distinct h1 + intro paragraph targeting the category's intent cluster
 *   - 4-5 FAQs that answer real questions for that category specifically
 *     (Netflix-Disney-Shahid behaviours differ from Spotify behaviours
 *     differ from PS Plus behaviours — the FAQs reflect that)
 *   - meta title + description tuned to common Arabic search variants
 *
 * The slugs match the database `products.category` values verbatim so
 * a category page can filter the catalog with a single equality query.
 */

export interface CategoryMeta {
  /** URL slug + database `products.category` value. */
  slug: "streaming" | "music" | "gaming" | "productivity";
  /** Short label used in chips, breadcrumbs, internal links. */
  label: string;
  /** Page <h1> — keyword-rich and natural. */
  h1: string;
  /** Hero intro paragraph (~80-120 words). */
  intro: string;
  /** Title element — Arabic intent + Libya signal. */
  metaTitle: string;
  /** Meta description — clickable CTR-shaped copy. */
  metaDescription: string;
  /** FAQ questions + answers. Surfaced as FAQPage JSON-LD + visible accordion. */
  faqs: { question: string; answer: string }[];
}

export const CATEGORY_META: Record<CategoryMeta["slug"], CategoryMeta> = {
  streaming: {
    slug: "streaming",
    label: "البث المباشر",
    h1: "اشتراكات البث المباشر في ليبيا",
    intro:
      "اختر اشتراكك المفضل لخدمات البث المباشر العالمية والعربية بالدينار الليبي. " +
      "نوفر اشتراكات Netflix، Disney+، Shahid VIP، Amazon Prime Video، Apple TV+، " +
      "Crunchyroll و YouTube Premium بأسعار محلية وتسليم فوري بعد الدفع. " +
      "كل الاشتراكات أصلية ومضمونة، مع دعم فني سريع طوال أيام الأسبوع. " +
      "ادفع من محفظتك بالدينار الليبي عبر مدار أو ليبيانا واستلم تفاصيل الحساب " +
      "خلال ثوانٍ. الاشتراك صالح للاستخدام في جميع المدن الليبية: طرابلس، " +
      "بنغازي، مصراتة، الزاوية، سبها، زليتن، وغيرها.",
    metaTitle: "اشتراكات البث المباشر في ليبيا — Netflix و Disney+ و Shahid",
    metaDescription:
      "اشترِ اشتراكات Netflix و Disney+ و Shahid VIP و Amazon Prime Video بالدينار " +
      "الليبي. تسليم فوري في طرابلس وبنغازي ومصراتة وكامل ليبيا.",
    faqs: [
      {
        question: "هل اشتراك Netflix يعمل في ليبيا؟",
        answer:
          "نعم، جميع اشتراكات البث المباشر التي نقدمها تعمل في ليبيا بدون أي قيود جغرافية. " +
          "تستلم بيانات الحساب فوراً بعد الدفع وتتمكن من الاستخدام مباشرة من المنزل أو الموبايل.",
      },
      {
        question: "كم تستغرق عملية تسليم الاشتراك بعد الدفع؟",
        answer:
          "التسليم فوري — يتم إرسال بيانات الحساب الكاملة خلال ثوانٍ من تأكيد الدفع. " +
          "إذا واجهت أي تأخير، يمكنك التواصل مع الدعم الفني عبر صفحة المساعدة.",
      },
      {
        question: "هل يمكنني الدفع بالدينار الليبي عبر مدار أو ليبيانا؟",
        answer:
          "نعم، نقبل الدفع بالدينار الليبي عبر شحن المحفظة بكلا الشبكتين. " +
          "بمجرد توفر الرصيد في محفظتك، يمكنك إتمام أي طلب بضغطة واحدة.",
      },
      {
        question: "ما الفرق بين اشتراك Netflix Premium و Disney+؟",
        answer:
          "Netflix Premium يدعم البث بدقة 4K UHD على 4 شاشات في نفس الوقت ويحتوي على " +
          "محتوى Netflix الأصلي. Disney+ يضم محتوى ديزني و Marvel و Star Wars و " +
          "National Geographic ويناسب العائلة. يمكنك مراجعة كل خدمة من صفحة المنتج.",
      },
      {
        question: "هل الاشتراك للاستخدام الشخصي فقط؟",
        answer:
          "نعم، شروط الاستخدام تنص على استخدام الاشتراك بشكل شخصي وعدم مشاركة بيانات " +
          "الحساب مع الغير أو تغيير كلمة المرور. مخالفة الشروط قد تؤدي إلى فقدان الاشتراك.",
      },
    ],
  },
  music: {
    slug: "music",
    label: "الموسيقى",
    h1: "اشتراكات الموسيقى الرقمية في ليبيا",
    intro:
      "استمع إلى ملايين الأغاني والبودكاست بدون إعلانات وبجودة صوت عالية على " +
      "Spotify Premium وغيره من خدمات الموسيقى الرقمية. كل الاشتراكات أصلية " +
      "وبأسعار بالدينار الليبي مع تسليم فوري بعد إتمام الدفع. الاشتراك يعمل " +
      "على الموبايل والكمبيوتر والسماعات الذكية، ويسمح بالتنزيل للاستماع بدون " +
      "إنترنت أثناء التنقل بين المدن. ادفع من محفظتك عبر مدار أو ليبيانا " +
      "واستمتع بمكتبة موسيقية لا حدود لها في كل أرجاء ليبيا.",
    metaTitle: "اشتراكات الموسيقى في ليبيا — Spotify Premium بالدينار الليبي",
    metaDescription:
      "اشترِ اشتراك Spotify Premium وخدمات الموسيقى الأخرى بالدينار الليبي. تسليم " +
      "فوري، جودة صوت عالية، استماع بدون إعلانات في كامل ليبيا.",
    faqs: [
      {
        question: "هل Spotify Premium يعمل في ليبيا؟",
        answer:
          "نعم، اشتراكات الموسيقى التي نقدمها تعمل في ليبيا بدون قيود. " +
          "بعد الدفع تستلم بيانات الحساب وتدخل التطبيق مباشرة على هاتفك.",
      },
      {
        question: "هل يمكنني تنزيل الأغاني للاستماع بدون إنترنت؟",
        answer:
          "نعم، Spotify Premium يسمح بتنزيل الأغاني والقوائم والبودكاست للاستماع " +
          "بدون اتصال إنترنت — مفيد جداً عند التنقل أو في المناطق ذات التغطية الضعيفة.",
      },
      {
        question: "هل الاشتراك يدعم الاستخدام على عدة أجهزة؟",
        answer:
          "نعم، يمكنك تثبيت Spotify على الموبايل والكمبيوتر اللوحي والكمبيوتر " +
          "والسماعات الذكية بنفس الحساب، مع شرط عدم تشغيله في وقت واحد على عدة أجهزة.",
      },
      {
        question: "ما طرق الدفع المتاحة؟",
        answer:
          "كل عمليات الشراء تتم بالدينار الليبي عبر شحن المحفظة من مدار أو ليبيانا. " +
          "بمجرد إتمام الدفع، يصلك الاشتراك خلال ثوانٍ.",
      },
    ],
  },
  gaming: {
    slug: "gaming",
    label: "الألعاب",
    h1: "اشتراكات وشحن الألعاب في ليبيا",
    intro:
      "اشتراكات Xbox Game Pass و PlayStation Plus وكل ما يحتاجه اللاعب الليبي " +
      "في مكان واحد. نقدم اشتراكات الألعاب الأصلية بأسعار بالدينار الليبي مع " +
      "تسليم فوري للأكواد بعد الدفع — لا انتظار، لا تعقيد. الاشتراك يفتح لك " +
      "مكتبة ضخمة من الألعاب الجديدة والكلاسيكية على PlayStation و Xbox، " +
      "ويناسب اللاعبين في طرابلس وبنغازي ومصراتة وكامل المدن الليبية. ادفع " +
      "من محفظتك واستمتع باللعب فوراً.",
    metaTitle: "اشتراكات وشحن الألعاب في ليبيا — PS Plus و Xbox Game Pass",
    metaDescription:
      "اشترِ اشتراكات PS Plus و Xbox Game Pass Ultimate وألعابك المفضلة بالدينار " +
      "الليبي. تسليم فوري للأكواد، أصلية ومضمونة، تعمل في كامل ليبيا.",
    faqs: [
      {
        question: "هل اشتراكات الألعاب أصلية وآمنة؟",
        answer:
          "نعم، جميع الاشتراكات أصلية ومُشتراة من المصادر الرسمية. تستلم كود " +
          "تفعيل أو بيانات حساب جاهزة للاستخدام مباشرة على PlayStation أو Xbox.",
      },
      {
        question: "كم يستغرق وصول كود اللعبة بعد الدفع؟",
        answer:
          "التسليم فوري — الكود يصلك خلال ثوانٍ بعد تأكيد الدفع، ويمكنك تفعيله " +
          "مباشرة من جهازك أو من خلال متجر اللعبة الرسمي.",
      },
      {
        question: "هل اشتراك PS Plus يعمل على PS5 و PS4؟",
        answer:
          "نعم، اشتراك PlayStation Plus يعمل على كلا الجيلين PS5 و PS4. " +
          "بعض المزايا (مثل الألعاب المجانية الشهرية) تختلف بحسب نوع الاشتراك " +
          "(Essential، Extra، Deluxe) — راجع تفاصيل كل منتج قبل الشراء.",
      },
      {
        question: "هل أحتاج VPN لتشغيل الاشتراك في ليبيا؟",
        answer:
          "لا، اشتراكات الألعاب التي نقدمها تعمل في ليبيا بدون أي حاجة لـ VPN " +
          "أو إعدادات إضافية. تثبت اللعبة وتلعب مباشرة.",
      },
      {
        question: "ماذا لو تعطل الكود أو لم يعمل؟",
        answer:
          "في حالة وجود أي مشكلة في الكود، تواصل مع الدعم الفني مباشرة من " +
          "صفحة طلباتك وسيتم استبداله أو رد المبلغ خلال 24 ساعة.",
      },
    ],
  },
  productivity: {
    slug: "productivity",
    label: "الإنتاجية والمكتب",
    h1: "اشتراكات أدوات الإنتاجية والعمل في ليبيا",
    intro:
      "كل الأدوات التي يحتاجها الموظف والطالب الليبي للعمل والدراسة في مكان " +
      "واحد. نوفر اشتراكات Microsoft 365 و Canva Pro و NordVPN وغيرها من " +
      "الأدوات المهنية بأسعار بالدينار الليبي. الاشتراكات أصلية ومضمونة، " +
      "تعمل على Windows و Mac و الموبايل، وتسلَّم فوراً بعد الدفع. مناسبة " +
      "لطلاب الجامعات في طرابلس وبنغازي، الموظفين عن بُعد، والمستقلين الذين " +
      "يحتاجون أدوات احترافية للعمل اليومي.",
    metaTitle: "اشتراكات الإنتاجية في ليبيا — Microsoft 365 و Canva Pro و NordVPN",
    metaDescription:
      "اشترِ اشتراكات Microsoft 365 و Canva Pro و NordVPN بالدينار الليبي. " +
      "أدوات احترافية أصلية للعمل والدراسة، تسليم فوري في كامل ليبيا.",
    faqs: [
      {
        question: "هل اشتراك Microsoft 365 يدعم اللغة العربية؟",
        answer:
          "نعم، Microsoft 365 يدعم اللغة العربية بالكامل في Word و Excel و " +
          "PowerPoint مع تخطيط من اليمين إلى اليسار، ويناسب الطلاب والموظفين " +
          "الذين يكتبون باللغة العربية بشكل يومي.",
      },
      {
        question: "كم جهازاً يمكنني تثبيت Microsoft 365 عليه؟",
        answer:
          "اشتراك Microsoft 365 Personal يدعم تثبيت التطبيقات على جهاز كمبيوتر " +
          "واحد + جهاز محمول، مع 1 تيرابايت تخزين OneDrive سحابي.",
      },
      {
        question: "ما الفرق بين Canva Free و Canva Pro؟",
        answer:
          "Canva Pro يفتح لك ملايين القوالب الاحترافية والصور والخطوط، إزالة " +
          "خلفية الصور بنقرة واحدة، وتحجيم التصاميم لكل المقاسات. مناسب " +
          "للمسوقين وصناع المحتوى الذين يحتاجون تصاميم احترافية بسرعة.",
      },
      {
        question: "هل اشتراك NordVPN يحمي البيانات أثناء الاتصال بالإنترنت في ليبيا؟",
        answer:
          "نعم، NordVPN يشفر اتصالك بالإنترنت ويحمي بياناتك الشخصية على " +
          "شبكات الواي فاي العامة، ويعمل بكفاءة على الإنترنت الليبي.",
      },
      {
        question: "هل تتم تجديد الاشتراكات تلقائياً؟",
        answer:
          "لا، اشتراكاتنا لا تتجدد تلقائياً. عند انتهاء المدة، تشتري اشتراكاً " +
          "جديداً من الموقع — بدون مفاجآت في كرت الائتمان.",
      },
    ],
  },
};

export const CATEGORY_SLUGS = Object.keys(CATEGORY_META) as CategoryMeta["slug"][];
