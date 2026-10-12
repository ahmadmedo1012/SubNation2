import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// 93-C7 / C-UX2 (A12 B6): session-status pills migrate from raw
// emerald/amber/blue/red hues to the canonical StatusBadge on the
// --status-* tokens.
import { StatusBadge } from "@/components/ui/status-badge";
import { Check, Copy, KeyRound, Loader2, Play, QrCode, Trash2 } from "lucide-react";
import { statusMeta, type WhatsAppSession } from "./whatsapp-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/whatsapp.tsx —
// the sessions list: per-row identity (name + status pill + id), the
// start/QR/delete action cluster, the pair-code form (phone field + issued
// code block with the R125-I5 staleness cue + copy feedback) and the QR
// image block. EVERYTHING that mutates stays in the page — the sessions
// array, the busy/pair/QR atoms and the copy feedback all ride down as
// values; start/QR/delete/pair/copy/open fire through page-owned
// callbacks. The move only changes its address; DOM, classes, aria labels
// and Arabic copy are byte-identical.

export function WhatsappSessionsList({
  sessions,
  busy,
  pairTarget,
  pairCode,
  pairCodeStale,
  pairCopied,
  qrImage,
  phone,
  onPhoneChange,
  onStartSession,
  onLoadQr,
  onDeleteSession,
  onRequestPairCode,
  onCopyPairCode,
  onOpenPairForm,
}: {
  sessions: WhatsAppSession[];
  busy: string | null;
  pairTarget: string | null;
  pairCode: string | null;
  pairCodeStale: boolean;
  pairCopied: boolean;
  qrImage: string | null;
  phone: string;
  onPhoneChange: (value: string) => void;
  onStartSession: (session: WhatsAppSession) => void | Promise<void>;
  onLoadQr: (session: WhatsAppSession) => void | Promise<void>;
  onDeleteSession: (session: WhatsAppSession) => void | Promise<void>;
  onRequestPairCode: (event: FormEvent<HTMLFormElement>) => void;
  onCopyPairCode: (code: string) => void | Promise<void>;
  onOpenPairForm: (sessionId: string) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {sessions.map((session) => {
        const meta = statusMeta(session.status);
        const sessionBusy = busy?.startsWith(`${session.id}:`);
        return (
          <div key={session.id} className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold truncate" dir="ltr">
                    {session.name}
                  </span>
                  <StatusBadge variant={meta.tone} size="sm">
                    {meta.label}
                  </StatusBadge>
                </div>
                <div className="text-2xs text-muted-foreground font-mono mt-1 truncate" dir="ltr">
                  {session.id}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onStartSession(session)}
                  disabled={sessionBusy}
                >
                  {busy === `${session.id}:start` ? <Loader2 className="animate-spin" /> : <Play />}
                  تشغيل
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onLoadQr(session)}
                  disabled={sessionBusy}
                >
                  {busy === `${session.id}:qr` ? <Loader2 className="animate-spin" /> : <QrCode />}
                  QR
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void onDeleteSession(session)}
                  disabled={sessionBusy}
                >
                  {busy === `${session.id}:delete` ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  حذف
                </Button>
              </div>
            </div>

            {pairTarget === session.id ? (
              <form
                onSubmit={onRequestPairCode}
                className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2"
              >
                <div className="text-xs text-muted-foreground">
                  اكتب رقم واتساب بصيغة دولية، مثال: <span dir="ltr">21891XXXXXXX</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={phone}
                    onChange={(event) => onPhoneChange(event.target.value)}
                    placeholder="21891XXXXXXX"
                    /* R125-I5 (A6-B13): name + tel autocomplete —
                        the field had inputMode="tel" but neither. */
                    aria-label="رقم واتساب بصيغة دولية"
                    autoComplete="tel"
                    inputMode="tel"
                    dir="ltr"
                    required
                  />
                  <Button type="submit" disabled={busy !== null}>
                    {busy === `${session.id}:pair` ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <KeyRound />
                    )}
                    إصدار رمز الاقتران
                  </Button>
                </div>
                {pairCode && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {/* R125-I5 (A3-12): staleness cue — the code dims
                        + a reissue hint appears after the TTL. The
                        copy button stays usable ("على الأرجح" — the
                        display can't know the true expiry; the
                        backend sends none). */}
                    <code
                      className={`text-xl font-bold tracking-[0.25em] bg-background border border-border rounded-lg px-3 py-2 transition-opacity ${
                        pairCodeStale ? "opacity-50" : ""
                      }`}
                      dir="ltr"
                    >
                      {pairCode}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void onCopyPairCode(pairCode)}
                    >
                      {pairCopied ? <Check /> : <Copy />}
                      {pairCopied ? "تم النسخ" : "نسخ"}
                    </Button>
                    {pairCodeStale && (
                      <span role="status" className="text-xs font-bold text-status-warning">
                        انتهت صلاحية الرمز على الأرجح — أعد إصدار رمز جديد
                      </span>
                    )}
                  </div>
                )}
              </form>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenPairForm(session.id)}
              >
                <KeyRound />
                ربط برمز الهاتف
              </Button>
            )}

            {qrImage && pairTarget === session.id && (
              <div className="rounded-xl border border-border bg-background p-4 flex flex-col items-center gap-2">
                <img src={qrImage} alt={`رمز QR لجلسة ${session.name}`} className="w-64 h-64" />
                <span className="text-xs text-muted-foreground">
                  من واتساب: الأجهزة المرتبطة ← ربط جهاز
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
