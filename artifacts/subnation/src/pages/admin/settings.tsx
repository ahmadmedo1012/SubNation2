import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { CheckCircle, XCircle, Bot, Key, Hash, Info, Bell, Shield } from "lucide-react";

interface TelegramSettings {
  telegram_configured: boolean;
  telegram_bot_set: boolean;
  telegram_chat_set: boolean;
}

const TABS = [
  { id: "integrations", label: "التكاملات", icon: Bot },
  { id: "notifications", label: "الإشعارات",  icon: Bell },
  { id: "security",     label: "الأمان",       icon: Shield },
];

export default function AdminSettingsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("integrations");

  useEffect(() => {
    if (!adminToken) return;
    fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${adminToken}` } })
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [adminToken]);

  if (!adminToken) { navigate("/admin/login"); return null; }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-black mb-0.5">الإعدادات</h1>
          <p className="text-muted-foreground text-sm">إعدادات النظام والتكاملات</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-secondary/50 border border-border rounded-xl p-1 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${activeTab === tab.id ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Integrations */}
        {activeTab === "integrations" && (
          <div className="space-y-5">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Bot className="w-4.5 h-4.5 text-blue-400" />
                </div>
                <div>
                  <h2 className="font-bold text-sm">تيليجرام</h2>
                  <p className="text-xs text-muted-foreground">إشعارات فورية للمشرفين</p>
                </div>
                <div className="mr-auto">
                  {settings && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${settings.telegram_configured ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                      {settings.telegram_configured ? "مفعّل" : "غير مفعّل"}
                    </span>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted skeleton-shimmer rounded-xl" />)}</div>
              ) : (
                <div className="space-y-2">
                  {[
                    { icon: Bot,  label: "الحالة العامة",       ok: settings?.telegram_configured, okText: "مفعّل ويعمل", failText: "غير مفعّل" },
                    { icon: Key,  label: "TELEGRAM_BOT_TOKEN",  ok: settings?.telegram_bot_set,    okText: "تم الضبط",   failText: "غير موجود" },
                    { icon: Hash, label: "TELEGRAM_CHAT_ID",    ok: settings?.telegram_chat_set,   okText: "تم الضبط",   failText: "غير موجود" },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between px-4 py-3 bg-muted/25 border border-border/60 rounded-xl">
                      <div className="flex items-center gap-2.5 text-sm">
                        <row.icon className="w-4 h-4 text-muted-foreground" />
                        <span className="font-mono text-xs">{row.label}</span>
                      </div>
                      <div className={`flex items-center gap-1.5 text-xs font-bold ${row.ok ? "text-emerald-400" : "text-red-400"}`}>
                        {row.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {row.ok ? row.okText : row.failText}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 p-4 bg-muted/30 border border-border/50 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-bold">كيفية الإعداد</span>
                </div>
                <ol className="space-y-2 text-xs text-muted-foreground leading-relaxed list-none">
                  {[
                    <>أنشئ بوت تيليجرام عبر <span className="font-mono text-primary">@BotFather</span> واحصل على التوكن</>,
                    <>أرسل رسالة للبوت ثم افتح <span className="font-mono text-[10px] text-primary">api.telegram.org/bot&#123;TOKEN&#125;/getUpdates</span> للحصول على Chat ID</>,
                    <>أضف <span className="font-mono text-primary">TELEGRAM_BOT_TOKEN</span> و <span className="font-mono text-primary">TELEGRAM_CHAT_ID</span> في متغيرات البيئة (Secrets)</>,
                    <>أعد تشغيل السيرفر</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground/60 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Notifications */}
        {activeTab === "notifications" && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-bold mb-4 text-sm">الأحداث التي يتم إشعارك بها</h2>
            <div className="space-y-2">
              {[
                "تسجيل مستخدم جديد",
                "طلب شحن محفظة جديد",
                "موافقة على طلب شحن",
                "رفض طلب شحن",
                "إتمام طلب شراء جديد",
              ].map(event => (
                <div key={event} className="flex items-center gap-3 px-4 py-3 bg-muted/20 border border-border/50 rounded-xl">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm">{event}</span>
                  <span className="mr-auto text-xs text-muted-foreground">عبر تيليجرام</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Security */}
        {activeTab === "security" && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-bold mb-4 text-sm">إعدادات الأمان</h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              {[
                { label: "تشفير JWT",       value: "SESSION_SECRET (env)",          ok: true },
                { label: "تشفير كلمات المرور", value: "SHA-256 + salt",           ok: true },
                { label: "تحديد معدل الطلبات", value: "20 طلب/15 دقيقة على المصادقة", ok: true },
                { label: "CORS",             value: "مقيّد بنطاقات REPLIT_DOMAINS", ok: true },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between px-4 py-3 bg-muted/20 border border-border/50 rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <Shield className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground/70">{item.value}</span>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
