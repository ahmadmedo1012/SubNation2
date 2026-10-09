import { useEffect, useState } from "react";
import { Shield, FileText, ChevronLeft } from "lucide-react";
import { Link } from "wouter";
import { useSeo } from "@/hooks/useSeo";

type Tab = "terms" | "privacy";

const TABS: { id: Tab; label: string; Icon: typeof FileText }[] = [
  { id: "terms", label: "الشروط والأحكام", Icon: FileText },
  { id: "privacy", label: "سياسة الخصوصية", Icon: Shield },
];

/**
 * Read the active tab from `window.location.hash`. Defaults to "terms".
 * Used so deep-links like `/terms#privacy` open directly on the privacy tab,
 * which the Footer relies on for its "سياسة الخصوصية" link.
 */
function tabFromHash(hash: string): Tab {
  const id = (hash || "").replace(/^#/, "").toLowerCase();
  return id === "privacy" ? "privacy" : "terms";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-foreground border-r-2 border-primary pr-3">
        {title}
      </h2>
      <div className="text-sm text-muted-foreground leading-7 space-y-2">{children}</div>
    </section>
  );
}

function TermsContent() {
  return (
    <div className="space-y-8">
      {/* 93-C8 (A11 §3/§12): Latin numerals per the site-wide number
          convention (utils.ts pins en-US digits) — the section numbers
          were the only Arabic-Indic islands left in the legal copy. */}
      <Section title="1. قبول الشروط">
        <p>
          باستخدامك لمنصة SubNation، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق
          على أي من هذه الشروط، يُرجى عدم استخدام الخدمة.
        </p>
      </Section>

      <Section title="2. طبيعة الخدمة">
        <p>
          {/* R123-E4b (P3-i): PS Plus removed — the gaming category was
              archived 2026-09-19 (R120/R122 scrubbed it from the rest of
              the app) and a terms page must not promise a category the
              live catalog no longer sells. Windows is live
              (windows-8 / windows-10-pro / windows-10-home — verified
              against the production sitemap). */}
          SubNation هي منصة لبيع الاشتراكات والتراخيص الرقمية في ليبيا. نوفر خدمات مثل Netflix
          وSpotify وتراخيص مثل Windows وغيرها بالدينار الليبي عبر وسائل الدفع المحلية.
        </p>
        <p>
          جميع المنتجات رقمية ويتم تسليمها فورياً أو خلال 24 ساعة بعد تأكيد الدفع. لا تنطبق سياسة
          الاسترداد على المنتجات الرقمية بعد تسليم بيانات الاشتراك.
        </p>
      </Section>

      <Section title="3. حساب المستخدم">
        {/* 93-C8 (A11 §2 top-20 #6 — legal honesty): SubNation is a
            passwordless platform (Google / Telegram / WhatsApp OTP —
            login.tsx states "بدون كلمة مرور"). The old text promised
            "كلمة المرور الخاصة بك" — a contractual obligation toward
            something the product does not have. Rewritten to the real
            duty: safeguard the account data and its linked sign-in
            methods. */}
        <p>
          أنت مسؤول عن الحفاظ على سرية بيانات حسابك وطرق الدخول المرتبطة به، وعن أي استخدام يجري من
          خلالها.
        </p>
        <p>يُمنع استخدام المنصة لأغراض غير مشروعة أو مخالفة للقانون الليبي.</p>
        <p>نحتفظ بالحق في تعليق أو إنهاء أي حساب يخالف هذه الشروط.</p>
      </Section>

      <Section title="4. الأسعار والدفع">
        <p>جميع الأسعار بالدينار الليبي (د.ل) وقابلة للتغيير دون إشعار مسبق.</p>
        <p>
          {/* R120-B5 (copy): «تحويل مصرفي» — the wallet page's canonical
              LyPay label (wallet.tsx). «تحويل بنكي» drifted from it. */}
          تتم عمليات الشحن عبر تحويل رصيد الهاتف (ليبيانا/مدار) أو تحويل مصرفي (LyPay). تُعالَج
          الطلبات خلال ساعات العمل.
        </p>
      </Section>

      <Section title="5. التسليم والاسترداد">
        <p>
          يتم تسليم بيانات الاشتراك فور التحقق من الدفع. في حال وجود خطأ في البيانات المُسلَّمة،
          يُرجى التواصل مع الدعم خلال 24 ساعة.
        </p>
        <p>
          لا يمكن استرداد المبالغ بعد تسليم بيانات الاشتراك الصحيحة، إلا في حالات الخلل الموثق من
          طرف مزود الخدمة.
        </p>
      </Section>

      <Section title="6. المسؤولية">
        <p>
          SubNation ليست مسؤولة عن أي انقطاع أو تغيير في خدمات الطرف الثالث (مثل Netflix وSpotify).
          في حال انتهاء خدمة بسبب سياسة المزود، يُبذل أقصى جهد لتعويض المستخدمين المتضررين.
        </p>
      </Section>

      <Section title="7. التعديلات">
        <p>
          نحتفظ بحق تعديل هذه الشروط في أي وقت. سيتم إخطار المستخدمين بالتغييرات الجوهرية عبر
          الإشعارات داخل التطبيق.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border/30">
        آخر تحديث: مايو 2026
      </p>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="space-y-8">
      <Section title="1. البيانات التي نجمعها">
        <p>عند التسجيل: رقم الهاتف (مطلوب للتحقق والتواصل).</p>
        <p>عند الشراء: بيانات الطلبات وطرق الدفع المستخدمة.</p>
        <p>تلقائياً: بيانات الاستخدام وسجلات الجلسات لتحسين الخدمة.</p>
      </Section>

      <Section title="2. كيف نستخدم بياناتك">
        <ul className="space-y-1.5 list-disc list-inside marker:text-primary/50">
          <li>معالجة الطلبات وتسليم المنتجات.</li>
          <li>إرسال إشعارات حول حالة الطلبات والشحن.</li>
          <li>توفير دعم العملاء والرد على الاستفسارات.</li>
          <li>تحسين تجربة المستخدم وتطوير الخدمة.</li>
        </ul>
      </Section>

      <Section title="3. مشاركة البيانات">
        <p>
          لا نبيع أو نؤجر بياناتك الشخصية لأطراف ثالثة. قد نشارك بيانات محدودة مع مزودي الخدمة
          الضروريين (مثل معالجات الدفع) لأغراض تقنية فقط.
        </p>
      </Section>

      <Section title="4. أمان البيانات">
        {/* 93-C8 (A11 §2 top-20 #6 — privacy §4 rewrite): the old text
            claimed encrypted stored passwords — the platform stores no
            user passwords at all (passwordless: OTP / Google /
            Telegram / WhatsApp). State the real guarantees: transport
            encryption, the provider sign-in model, revocable session
            tokens. */}
        <p>
          نستخدم تشفير HTTPS لجميع الاتصالات. الدخول إلى المنصة يتم عبر رموز تحقق مؤقتة أو مزودي
          دخول موثوقين (Google و Telegram و WhatsApp)، ولا نحتفظ بأي كلمات مرور على المنصة. جلسات
          الدخول محكومة برموز مؤقتة قابلة للإبطال في أي وقت.
        </p>
      </Section>

      <Section title="5. حقوقك">
        <p>
          يحق لك في أي وقت: طلب الاطلاع على بياناتك، تصحيحها، أو حذف حسابك كلياً عبر التواصل مع
          الدعم.
        </p>
      </Section>

      <Section title="6. ملفات تعريف الارتباط">
        <p>
          نستخدم التخزين المحلي (localStorage) فقط لحفظ إعدادات الجلسة والمظهر. لا نستخدم ملفات تتبع
          إعلانية.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border/30">
        آخر تحديث: مايو 2026
      </p>
    </div>
  );
}

export default function TermsPage() {
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" ? tabFromHash(window.location.hash) : "terms",
  );

  // Sync the active tab when the hash changes (back/forward, or another
  // intra-app link to /terms#privacy). Push a new hash when the user
  // clicks a tab so deep-links stay shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => setTab(tabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTabClick = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      // Use replaceState so back-button still leaves /terms cleanly.
      const newUrl = `${window.location.pathname}#${next}`;
      window.history.replaceState(null, "", newUrl);
    }
  };

  // SEO — title + description track the active tab so /terms and
  // /terms#privacy report different titles to Google (a legit CTR
  // signal). R124-I4 (A10 #4): the canonical/og:url is now always
  // "/terms" — Google strips fragments from canonicals (non-standard)
  // and an og:url with a fragment mismatches the sitemap URL; the
  // in-page #privacy anchor stays for UX/deep-links only. Both tabs
  // are legal/policy content with no transactional value, so robots
  // stays index,follow but priority in the sitemap is low.
  const isPrivacy = tab === "privacy";
  const seoBlock = useSeo({
    title: isPrivacy ? "سياسة الخصوصية — SubNation" : "الشروط والأحكام — SubNation",
    description: isPrivacy
      ? "كيف يجمع SubNation بياناتك ويحميها أثناء استخدامك المتجر وشحن المحفظة وشراء الاشتراكات."
      : "شروط استخدام منصة SubNation: سياسة الشراء، شحن المحفظة، الاشتراكات الرقمية، والاسترداد.",
    path: "/terms",
    locale: "ar",
    type: "website",
  });

  return (
    // R120-B5 (A3-F7): dvh straggler — the project's viewport-fill
    // convention (home.tsx:416): min-h-[100dvh], not min-h-screen, so
    // mobile browser chrome can't over-scroll the page shell.
    <div className="max-w-2xl mx-auto px-4 py-8 min-h-[100dvh]">
      {seoBlock}
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-7">
        <Link href="/">
          <span className="hover:text-foreground cursor-pointer transition-colors">الرئيسية</span>
        </Link>
        {/* RTL breadcrumb separator points right (unified icon-direction decision) */}
        <ChevronLeft className="w-3 h-3 rotate-180 opacity-50" />
        <span className="text-foreground/70">{TABS.find((t) => t.id === tab)?.label}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">المعلومات القانونية</h1>
        <p className="text-sm text-muted-foreground">SubNation — سوق الاشتراكات الرقمية في ليبيا</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-secondary/50 border border-border rounded-xl p-1 mb-8">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => handleTabClick(id)}
            /* R124-I4 (A5 #2): the active tab was conveyed by bg/bold
               only — aria-pressed per the tested toggle-pill idiom
               (home.tsx category chips). */
            aria-pressed={tab === id}
            /* R123-E4b (P3-f): min-h-11 — the old px-4 py-2.5 chip measured
                ≈40px, under the 44px touch floor the app enforces on every
                other control. */
            className={`min-h-11 flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 ${
              tab === id
                ? "bg-card shadow-sm text-foreground font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
        {tab === "terms" && <TermsContent />}
        {tab === "privacy" && <PrivacyContent />}
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-muted-foreground mt-8">
        للاستفسار والتواصل:{" "}
        <Link href="/support">
          <span className="underline underline-offset-2 hover:text-muted-foreground cursor-pointer transition-colors">
            صفحة الدعم
          </span>
        </Link>
      </p>
    </div>
  );
}
