import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useColors, radius, spacing } from "@/theme";

/**
 * Terms & privacy — a faithful port of the web's /terms page content
 * (frontend/src/pages/terms.tsx): the two-tab legal surface with every
 * section heading and paragraph verbatim, the October-2026 freshness
 * stamps, and the support footer note.
 *
 * Not auth-gated: legal reference content is public on the web twin
 * (the spec's blanket auth-gate covers data-bearing screens; this one
 * reads no API at all).
 */

type Tab = "terms" | "privacy";

const TABS: { id: Tab; label: string }[] = [
  { id: "terms", label: "الشروط والأحكام" },
  { id: "privacy", label: "سياسة الخصوصية" },
];

export function TermsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("terms");

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}
    >
      {/* Header */}
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="title">المعلومات القانونية</ThemedText>
        <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
          SubNation — سوق الاشتراكات الرقمية في ليبيا
        </ThemedText>
      </View>

      {/* Tab switcher */}
      <View
        style={{ flexDirection: "row", gap: spacing.sm }}
        accessibilityLabel="أقسام المعلومات القانونية"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t.id)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                minHeight: spacing.touch,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: active ? `${colors.primary}55` : colors.border,
                backgroundColor: active
                  ? `${colors.primary}1A`
                  : pressed
                    ? colors.secondary
                    : colors.surfaceCard,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <ThemedText
                variant="subhead"
                style={{
                  color: active ? colors.primary : colors.foreground,
                  fontFamily: active ? "ReadexPro-SemiBold" : "ReadexPro-Regular",
                  textAlign: "center",
                }}
              >
                {t.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
          gap: spacing.xl,
        }}
      >
        {tab === "terms" ? <TermsContent /> : <PrivacyContent />}
      </View>

      {/* Footer note */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="صفحة الدعم"
        onPress={() => router.push("/(tabs)/(account)/support")}
        style={({ pressed }) => ({ alignItems: "center", opacity: pressed ? 0.7 : 1 })}
      >
        <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
          للاستفسار والتواصل:{" "}
          <ThemedText
            variant="footnote"
            style={{ color: colors.primary, textDecorationLine: "underline" }}
          >
            صفحة الدعم
          </ThemedText>
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

// ── Section shell ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: spacing.sm }}>
      {/* The web's logical-side primary stripe on section headings. */}
      <View
        style={{ borderStartWidth: 2, borderStartColor: colors.primary, paddingStart: spacing.md }}
      >
        <ThemedText variant="headline">{title}</ThemedText>
      </View>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
  );
}

function Body({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <ThemedText variant="callout" style={{ color: colors.onSurface }} selectable>
      {children}
    </ThemedText>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
      <Icon sf="circle.fill" md="fiber-manual-record" size={6} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Body>{children}</Body>
      </View>
    </View>
  );
}

function UpdatedStamp() {
  const colors = useColors();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: `${colors.border}66`,
        paddingTop: spacing.md,
      }}
    >
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        آخر تحديث: أكتوبر 2026
      </ThemedText>
    </View>
  );
}

// ── Terms tab (verbatim port) ───────────────────────────────────────────────

function TermsContent() {
  return (
    <View style={{ gap: spacing.xl }}>
      <Section title="1. قبول الشروط">
        <Body>
          باستخدامك لمنصة SubNation، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق
          على أي من هذه الشروط، يُرجى عدم استخدام الخدمة.
        </Body>
      </Section>

      <Section title="2. طبيعة الخدمة">
        <Body>
          SubNation هي منصة لبيع الاشتراكات والتراخيص الرقمية في ليبيا. نوفر خدمات مثل Netflix
          وSpotify وتراخيص مثل Windows وغيرها بالدينار الليبي عبر وسائل الدفع المحلية.
        </Body>
        <Body>
          جميع المنتجات رقمية ويتم تسليمها فورياً أو خلال 24 ساعة بعد تأكيد الدفع. لا تنطبق سياسة
          الاسترداد على المنتجات الرقمية بعد تسليم بيانات الاشتراك.
        </Body>
      </Section>

      <Section title="3. حساب المستخدم">
        <Body>
          أنت مسؤول عن الحفاظ على سرية بيانات حسابك وطرق الدخول المرتبطة به، وعن أي استخدام يجري من
          خلالها.
        </Body>
        <Body>يُمنع استخدام المنصة لأغراض غير مشروعة أو مخالفة للقانون الليبي.</Body>
        <Body>نحتفظ بالحق في تعليق أو إنهاء أي حساب يخالف هذه الشروط.</Body>
      </Section>

      <Section title="4. الأسعار والدفع">
        <Body>جميع الأسعار بالدينار الليبي (د.ل) وقابلة للتغيير دون إشعار مسبق.</Body>
        <Body>
          تتم عمليات الشحن عبر تحويل رصيد الهاتف (ليبيانا/مدار) أو تحويل مصرفي (LyPay). تُعالَج
          الطلبات خلال ساعات العمل.
        </Body>
      </Section>

      <Section title="5. التسليم والاسترداد">
        <Body>
          يتم تسليم بيانات الاشتراك فور التحقق من الدفع. في حال وجود خطأ في البيانات المُسلَّمة،
          يُرجى التواصل مع الدعم خلال 24 ساعة.
        </Body>
        <Body>
          لا يمكن استرداد المبالغ بعد تسليم بيانات الاشتراك الصحيحة، إلا في حالات الخلل الموثق من
          طرف مزود الخدمة.
        </Body>
      </Section>

      <Section title="6. المسؤولية">
        <Body>
          SubNation ليست مسؤولة عن أي انقطاع أو تغيير في خدمات الطرف الثالث (مثل Netflix وSpotify).
          في حال انتهاء خدمة بسبب سياسة المزود، يُبذل أقصى جهد لتعويض المستخدمين المتضررين.
        </Body>
      </Section>

      <Section title="7. التعديلات">
        <Body>
          نحتفظ بحق تعديل هذه الشروط في أي وقت. سيتم إخطار المستخدمين بالتغييرات الجوهرية عبر
          الإشعارات داخل التطبيق.
        </Body>
      </Section>

      <UpdatedStamp />
    </View>
  );
}

// ── Privacy tab (verbatim port) ─────────────────────────────────────────────

function PrivacyContent() {
  return (
    <View style={{ gap: spacing.xl }}>
      <Section title="1. البيانات التي نجمعها">
        <Body>عند التسجيل: رقم الهاتف (مطلوب للتحقق والتواصل).</Body>
        <Body>عند الشراء: بيانات الطلبات وطرق الدفع المستخدمة.</Body>
        <Body>تلقائياً: بيانات الاستخدام وسجلات الجلسات لتحسين الخدمة.</Body>
      </Section>

      <Section title="2. كيف نستخدم بياناتك">
        <Bullet>معالجة الطلبات وتسليم المنتجات.</Bullet>
        <Bullet>إرسال إشعارات حول حالة الطلبات والشحن.</Bullet>
        <Bullet>توفير دعم العملاء والرد على الاستفسارات.</Bullet>
        <Bullet>تحسين تجربة المستخدم وتطوير الخدمة.</Bullet>
      </Section>

      <Section title="3. مشاركة البيانات">
        <Body>
          لا نبيع أو نؤجر بياناتك الشخصية لأطراف ثالثة. قد نشارك بيانات محدودة مع مزودي الخدمة
          الضروريين (مثل معالجات الدفع) لأغراض تقنية فقط.
        </Body>
      </Section>

      <Section title="4. أمان البيانات">
        <Body>
          نستخدم تشفير HTTPS لجميع الاتصالات. الدخول إلى المنصة يتم عبر رموز تحقق مؤقتة أو مزودي
          دخول موثوقين (Google و Telegram و WhatsApp)، ولا نحتفظ بأي كلمات مرور على المنصة. جلسات
          الدخول محكومة برموز مؤقتة قابلة للإبطال في أي وقت.
        </Body>
      </Section>

      <Section title="5. حقوقك">
        <Body>
          يحق لك في أي وقت: طلب الاطلاع على بياناتك، تصحيحها، أو حذف حسابك كلياً عبر التواصل مع
          الدعم.
        </Body>
      </Section>

      <Section title="6. ملفات تعريف الارتباط">
        <Body>
          نستخدم التخزين المحلي (localStorage) فقط لحفظ إعدادات الجلسة والمظهر. لا نستخدم ملفات تتبع
          إعلانية.
        </Body>
      </Section>

      <UpdatedStamp />
    </View>
  );
}
