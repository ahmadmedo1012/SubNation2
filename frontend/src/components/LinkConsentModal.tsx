/**
 * Account-link consent modal — F-003 (security audit 004).
 *
 * Rendered when the backend's `/api/auth/firebase/session` returns 409
 * with `reason: "link_consent_required"`. Shows the masked candidate
 * (e.g. `j••••@example.com` / `9•••••••78`) and asks the user to
 * confirm linking the new Firebase identity to that existing account.
 *
 * UX choices:
 *   - The mask leaks only enough information for the legitimate user
 *     to recognise their own account; not enough for a targeted
 *     attacker to confirm a guess.
 *   - The accept button uses the warning tone so the user reads the
 *     prompt; the cancel button is the no-op default.
 *   - Escape and outside-click cancel — never accidentally accept.
 *   - Single-flight: the loading state disables both buttons while
 *     the second backend call is in flight.
 *   - All copy is Arabic-first per Constitution Domain Constraints.
 */

import { Loader2, Link2, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import type { LinkConsentCandidateHint } from "@/lib/firebase-auth";

interface LinkConsentModalProps {
  hint: LinkConsentCandidateHint;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LinkConsentModal({ hint, loading, onConfirm, onCancel }: LinkConsentModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, loading]);

  // Pick whichever hint the backend was able to mask. Email beats
  // phone when both exist (more recognisable to the user).
  const identifier = hint.maskedEmail ?? hint.maskedPhone ?? null;

  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-consent-title"
    >
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-status-warning/10 border border-status-warning/22 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-status-warning" />
          </div>
          <div className="flex-1">
            <h3 id="link-consent-title" className="font-black text-sm">
              تأكيد ربط الحساب
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              وجدنا حساباً قائماً يطابق هذه الهوية
            </p>
          </div>
        </div>

        <div className="bg-muted/40 border border-border/60 rounded-xl p-3 mb-4">
          <p className="text-xs text-muted-foreground mb-1">سيتم ربط هذا الحساب:</p>
          <p
            className="text-sm font-mono font-bold text-foreground"
            data-testid="link-consent-identifier"
            dir="ltr"
          >
            {identifier ?? "(حساب موجود)"}
          </p>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
          إذا لم يكن هذا حسابك، اختر <span className="font-bold">إلغاء</span> وتواصل مع الدعم.
          الموافقة تعني السماح بتسجيل الدخول لهذا الحساب عبر طريقة الدخول الجديدة.
        </p>

        <div className="flex gap-2.5">
          <button
            type="button"
            className="flex-1 h-10 rounded-xl border border-border bg-card hover:bg-muted/50 text-sm font-bold press-spring active:scale-[0.97] disabled:opacity-60"
            onClick={onCancel}
            disabled={loading}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold inline-flex items-center justify-center gap-2 press-spring active:scale-[0.97] shadow-md shadow-primary/22 disabled:opacity-60"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="w-4 h-4" aria-hidden="true" />
            )}
            {loading ? "جارٍ الربط..." : "تأكيد الربط"}
          </button>
        </div>
      </div>
    </div>
  );
}
