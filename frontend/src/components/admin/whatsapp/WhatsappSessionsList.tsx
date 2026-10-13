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
    /* R139 (precision): the session rows join the /20 hairline rhythm —
       the r139 lane spec's receipt register for session/device info rows
       (the in-card separator value 139-e shipped on the mobile order
       cards). NOTE for seam triage: the system lane's top-level list
       cards (RecentAlerts / top-routes) ride divide-border/40 — one step
       firmer; the whatsapp rows sit INSIDE the section card so the
       softer hairline reads as the nested layer. Row DOM byte-identical. */
    <div className="divide-y divide-border/20">
      {sessions.map((session) => {
        const meta = statusMeta(session.status);
        const sessionBusy = busy?.startsWith(`${session.id}:`);
        return (
          /* R139 (precision): VERIFIED, no change — the connection status
             rides the canonical StatusBadge (STATUS_META tone tokens:
             success/warning/info/error per state, the 93-C7 migration);
             quiet tinted pill, never a full-status wall. Session identity
             (name/id) stays dir="ltr" mono. */
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
                  variant="outline"
                  /* R139 (precision): quiet danger at rest (139-e's
                     TopupCard reject recipe) — the solid destructive
                     fill retires for the neutral outline register; the
                     error ink surfaces on hover and the severity lives
                     in the useConfirm destructive dialog the page fires
                     («حذف الجلسة؟», destructive: true). onClick/disabled/
                     spinner ternary byte-identical. */
                  className="text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10"
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
                /* R139 (precision): the pair form's panel joins the resting
                   register (139-f's VariantFormPanel recipe): the brand-tinted
                   border-primary/20 + bg-primary/5 retires for
                   border-border/60 + the bg-muted/15 wash — the active
                   pairing target is carried by the form's own contents (the
                   primary submit + the issued code), not a tinted shell.
                   onSubmit + every field byte-identical. */
                className="rounded-xl border border-border/60 bg-muted/15 p-3 space-y-2"
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
                    {/* R139 (precision): the code chip's edge joins the
                       resting family (border-border/60 — was the
                       full-strength border-border); bg-background stays
                       for the value-token contrast inside the muted panel. */}
                    <code
                      className={`text-xl font-bold tracking-[0.25em] bg-background border border-border/60 rounded-lg px-3 py-2 transition-opacity ${
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
              /* R139 (precision): the QR stage joins the calm well family —
                 bg-muted/60 + border-border/40 (the cart-thumbnail /
                 enrichment copy-well / GlobalSearch image-shelf register);
                 was bg-background + the full-strength border-border. The
                 64×64 QR art + caption + alt byte-identical. */
              <div className="rounded-xl border border-border/40 bg-muted/60 p-4 flex flex-col items-center gap-2">
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
