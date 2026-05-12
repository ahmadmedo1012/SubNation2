import { useState } from "react";
import { Shield, FileText, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

type Tab = "terms" | "privacy";

const TABS: { id: Tab; label: string; Icon: typeof FileText }[] = [
  { id: "terms", label: "الشروط والأحكام", Icon: FileText },
  { id: "privacy", label: "سياسة الخصوصية", Icon: Shield },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-black text-foreground border-r-2 border-primary pr-3">
        {title}
      </h2>
      <div className="text-sm text-muted-foreground leading-7 space-y-2">{children}</div>
    </section>
  );
}

function TermsContent() {
  return (
    <div className="space-y-8">
      <Section title="١. قبول الشروط">
        <p>
          باستخدامك لمنصة SubNation، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق
          على أي من هذه الشروط، يُرجى عدم استخدام الخدمة.
        </p>
      </Section>

      <Section title="٢. طبيعة الخدمة">
        <p>
          SubNation هي منصة لبيع الاشتراكات الرقمية في ليبيا. نوفر اشتراكات خدمات مثل Netflix
          وSpotify وPS Plus وغيرها بالدينار الليبي عبر وسائل الدفع المحلية.
        </p>
        <p>
          جميع المنتجات رقمية ويتم تسليمها فورياً أو خلال 24 ساعة بعد تأكيد الدفع. لا تنطبق سياسة
          الاسترجاع على المنتجات الرقمية بعد تسليم بيانات الاشتراك.
        </p>
      </Section>

      <Section title="٣. حساب المستخدم">
        <p>أنت مسؤول عن الحفاظ على سرية معلومات حسابك وكلمة المرور الخاصة بك.</p>
        <p>يُمنع استخدام المنصة لأغراض غير مشروعة أو مخالفة للقانون الليبي.</p>
        <p>نحتفظ بالحق في تعليق أو إنهاء أي حساب يخالف هذه الشروط.</p>
      </Section>

      <Section title="٤. الأسعار والدفع">
        <p>جميع الأسعار بالدينار الليبي (د.ل) وقابلة للتغيير دون إشعار مسبق.</p>
        <p>
          تتم عمليات الشحن عبر تحويل رصيد الهاتف (ليبيانا/مدار) أو تحويل بنكي (LyPay). تُعالَج
          الطلبات خلال ساعات العمل.
        </p>
      </Section>

      <Section title="٥. التسليم والاسترجاع">
        <p>
          يتم تسليم بيانات الاشتراك فور التحقق من الدفع. في حال وجود خطأ في البيانات المُسلَّمة،
          يُرجى التواصل مع الدعم خلال 24 ساعة.
        </p>
        <p>
          لا يمكن استرجاع المبالغ بعد تسليم بيانات الاشتراك الصحيحة، إلا في حالات الخلل الموثق من
          طرف مزود الخدمة.
        </p>
      </Section>

      <Section title="٦. المسؤولية">
        <p>
          SubNation ليست مسؤولة عن أي انقطاع أو تغيير في خدمات الطرف الثالث (مثل Netflix وSpotify).
          في حال انتهاء خدمة بسبب سياسة المزود، يُبذل أقصى جهد لتعويض المستخدمين المتضررين.
        </p>
      </Section>

      <Section title="٧. التعديلات">
        <p>
          نحتفظ بحق تعديل هذه الشروط في أي وقت. سيتم إخطار المستخدمين بالتغييرات الجوهرية عبر
          الإشعارات داخل التطبيق.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border/30">
        آخر تحديث: مايو ٢٠٢٦
      </p>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="space-y-8">
      <Section title="١. البيانات التي نجمعها">
        <p>عند التسجيل: رقم الهاتف (مطلوب للتحقق والتواصل).</p>
        <p>عند الشراء: بيانات الطلبات وطرق الدفع المستخدمة.</p>
        <p>تلقائياً: بيانات الاستخدام وسجلات الجلسات لتحسين الخدمة.</p>
      </Section>

      <Section title="٢. كيف نستخدم بياناتك">
        <ul className="space-y-1.5 list-disc list-inside marker:text-primary/50">
          <li>معالجة الطلبات وتسليم المنتجات.</li>
          <li>إرسال إشعارات حول حالة الطلبات والشحن.</li>
          <li>توفير دعم العملاء والرد على الاستفسارات.</li>
          <li>تحسين تجربة المستخدم وتطوير الخدمة.</li>
        </ul>
      </Section>

      <Section title="٣. مشاركة البيانات">
        <p>
          لا نبيع أو نؤجر بياناتك الشخصية لأطراف ثالثة. قد نشارك بيانات محدودة مع مزودي الخدمة
          الضروريين (مثل معالجات الدفع) لأغراض تقنية فقط.
        </p>
      </Section>

      <Section title="٤. أمان البيانات">
        <p>
          نستخدم تشفير HTTPS لجميع الاتصالات. كلمات المرور مُشفَّرة ولا يمكن الاطلاع عليها حتى من
          قِبَل فريق الإدارة.
        </p>
      </Section>

      <Section title="٥. حقوقك">
        <p>
          يحق لك في أي وقت: طلب الاطلاع على بياناتك، تصحيحها، أو حذف حسابك كلياً عبر التواصل مع
          الدعم.
        </p>
      </Section>

      <Section title="٦. ملفات تعريف الارتباط">
        <p>
          نستخدم التخزين المحلي (localStorage) فقط لحفظ إعدادات الجلسة والمظهر. لا نستخدم ملفات تتبع
          إعلانية.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border/30">
        آخر تحديث: مايو ٢٠٢٦
      </p>
    </div>
  );
}

export default function TermsPage() {
  const [tab, setTab] = useState<Tab>("terms");

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-7">
        <Link href="/">
          <span className="hover:text-foreground cursor-pointer transition-colors">الرئيسية</span>
        </Link>
        <ChevronLeft className="w-3 h-3" />
        <span className="text-foreground/70">{TABS.find((t) => t.id === tab)?.label}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-1">المعلومات القانونية</h1>
        <p className="text-sm text-muted-foreground">SubNation — سوق الاشتراكات الرقمية في ليبيا</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-secondary/50 border border-border rounded-xl p-1 mb-8">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
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
