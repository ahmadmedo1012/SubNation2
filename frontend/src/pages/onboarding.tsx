import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export function OnboardingPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [isChecking, setIsChecking] = useState(true);
  const { data: user } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  useEffect(() => {
    if (!token) {
      navigate("/login");
      setIsChecking(false);
      return;
    }

    // Only redirect if user data is loaded and user is onboarded
    if (user && (user as { onboarded_at?: string }).onboarded_at) {
      navigate("/");
      return;
    }

    setIsChecking(false);
  }, [token, user, navigate]);

  const handleCompleteOnboarding = async () => {
    try {
      await fetch("/api/auth/onboarding/complete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      navigate("/");
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
    }
  };

  const handleNextStep = async () => {
    if (step < 5) {
      setStep(step + 1);
    } else {
      await handleCompleteOnboarding();
    }
  };

  if (isChecking)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        جاري التحميل...
      </div>
    );
  if (!token) return null;
  if (user && (user as { onboarded_at?: string }).onboarded_at) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-2xl bg-card rounded-lg shadow-lg p-8">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`h-2 flex-1 mx-1 rounded ${s <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground text-center">الخطوة {step} من 5</p>
        </div>

        {step === 1 && (
          <div className="text-center space-y-6">
            <h1 className="text-3xl font-bold">مرحباً بك في SubNation2!</h1>
            <p className="text-lg text-muted-foreground">
              منصة شراء بطاقات وألعاب رقمية بأفضل الأسعار في ليبيا
            </p>
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="p-4 border rounded">
                <div className="text-2xl mb-2">🎮</div>
                <p className="text-sm">بطاقات ألعاب</p>
              </div>
              <div className="p-4 border rounded">
                <div className="text-2xl mb-2">⚡</div>
                <p className="text-sm">تسليم فوري</p>
              </div>
              <div className="p-4 border rounded">
                <div className="text-2xl mb-2">🔒</div>
                <p className="text-sm">دفع آمن</p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-center">أكمل ملفك الشخصي</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">الاسم المعروض</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded"
                  placeholder="أدخل اسمك"
                  defaultValue={(user as { display_name?: string })?.display_name || ""}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                يمكنك إضافة صورة الملف الشخصي لاحقاً من صفحة الملف الشخصي
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-center">إعدادات الأمان</h2>
            <div className="space-y-4">
              <div className="p-4 border rounded">
                <h3 className="font-semibold mb-2">المصادقة الثنائية (اختياري)</h3>
                <p className="text-sm text-muted-foreground">
                  يمكنك تفعيل المصادقة الثنائية لزيادة أمان حسابك
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-center">ربط حسابات إضافية</h2>
            <p className="text-center text-muted-foreground">يمكنك ربط حساب Google للدخول السريع</p>
            <div className="p-4 border rounded text-center">
              <p className="text-sm text-muted-foreground">
                يمكنك ربط حسابات إضافية من صفحة الملف الشخصي
              </p>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="text-center space-y-6">
            <h2 className="text-2xl font-bold">جاهز للبدء!</h2>
            <p className="text-lg text-muted-foreground">
              لقد أكملت الإعداد الأولي. يمكنك الآن استعراض منتجاتنا وشراء بطاقاتك المفضلة.
            </p>
            <div className="p-4 border rounded bg-muted">
              <p className="text-sm">نصائح سريعة:</p>
              <ul className="text-sm text-right mt-2 space-y-1">
                <li>• تصفح فئات المنتجات المختلفة</li>
                <li>• أضف رصيد إلى محفظتك</li>
                <li>• راجع طلباتك من صفحة الطلبات</li>
              </ul>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-8 pt-4 border-t border-border/20">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="h-11 px-8 press-spring font-bold"
          >
            السابق
          </Button>
          <Button onClick={handleNextStep} className="h-11 px-8 press-spring font-bold">
            {step === 5 ? "إكمال" : "التالي"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OnboardingPage;
