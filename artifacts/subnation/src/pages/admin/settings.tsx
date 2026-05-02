import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { Settings, CheckCircle, XCircle, Bot, Key, Hash } from "lucide-react";

interface TelegramSettings {
  telegram_configured: boolean;
  telegram_bot_set: boolean;
  telegram_chat_set: boolean;
}

export default function AdminSettingsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!adminToken) return;
    fetch("/api/admin/settings", {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [adminToken]);

  if (!adminToken) { navigate("/admin/login"); return null; }

  return (
    <AdminLayout>
      <div>
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-black">الإعدادات</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Bot className="w-5 h-5 text-primary" />
              <h2 className="font-bold">إشعارات تيليجرام</h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-3">
                <StatusRow
                  icon={<Bot className="w-4 h-4" />}
                  label="الحالة العامة"
                  ok={settings?.telegram_configured ?? false}
                  okText="مفعّل ويعمل"
                  failText="غير مفعّل"
                />
                <StatusRow
                  icon={<Key className="w-4 h-4" />}
                  label="TELEGRAM_BOT_TOKEN"
                  ok={settings?.telegram_bot_set ?? false}
                  okText="تم الضبط"
                  failText="غير موجود"
                />
                <StatusRow
                  icon={<Hash className="w-4 h-4" />}
                  label="TELEGRAM_CHAT_ID"
                  ok={settings?.telegram_chat_set ?? false}
                  okText="تم الضبط"
                  failText="غير موجود"
                />
              </div>
            )}

            <div className="mt-6 p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground space-y-2">
              <p className="font-bold text-foreground">كيفية الإعداد:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                <li>أنشئ بوت تيليجرام عبر <span className="font-mono text-primary">@BotFather</span> واحصل على التوكن</li>
                <li>أرسل رسالة للبوت ثم افتح <span className="font-mono text-xs">api.telegram.org/bot&#123;TOKEN&#125;/getUpdates</span> للحصول على Chat ID</li>
                <li>أضف <span className="font-mono text-primary">TELEGRAM_BOT_TOKEN</span> و <span className="font-mono text-primary">TELEGRAM_CHAT_ID</span> في متغيرات البيئة (Secrets)</li>
                <li>أعد تشغيل السيرفر</li>
              </ol>
            </div>

            <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground">
              <strong className="text-foreground">الأحداث التي يتم إشعارك بها:</strong>
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                <li>تسجيل مستخدم جديد</li>
                <li>طلب شحن محفظة جديد</li>
                <li>موافقة أو رفض شحن</li>
                <li>إتمام طلب شراء</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusRow({ icon, label, ok, okText, failText }: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`flex items-center gap-1.5 text-xs font-bold ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
        {ok ? okText : failText}
      </div>
    </div>
  );
}
