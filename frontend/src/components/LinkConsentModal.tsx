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
 *   - The accept button uses the primary tone so the user reads the
 *     prompt; the cancel button is the no-op default.
 *   - Escape and outside-click cancel — never accidentally accept.
 *   - Single-flight: the loading state disables both buttons while
 *     the second backend call is in flight.
 *   - All copy is Arabic-first per Constitution Domain Constraints.
 *
 * 94-C3 (A3 P1-2): migrated onto the shared AppDialog shell (Radix)
 * from a hand-rolled overlay — the old div + onClick backdrop had no
 * focus trap, no initial focus move, no focus restore and no body
 * scroll-lock. AppDialog provides all four plus the guarded-dismiss
 * idiom (`dismissable={!loading}`) that replaces the old manual
 * Escape/outside-click guards.
 */

import { Loader2, Link2, ShieldAlert } from "lucide-react";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import type { LinkConsentCandidateHint } from "@/lib/firebase-auth";

interface LinkConsentModalProps {
  hint: LinkConsentCandidateHint;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LinkConsentModal({ hint, loading, onConfirm, onCancel }: LinkConsentModalProps) {
  // Pick whichever hint the backend was able to mask. Email beats
  // phone when both exist (more recognisable to the user).
  const identifier = hint.maskedEmail ?? hint.maskedPhone ?? null;

  return (
    <AppDialog
      // Always mounted open — the parent mounts this component only
      // while a consent decision is pending, so `open` is constant.
      open
      // Radix routes every dismiss path (ESC / backdrop / close
      // button) through here with `false`; AppDialog already blocks
      // them all while `loading`, this guard covers the rest.
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
      title="تأكيد ربط الحساب"
      description="وجدنا حساباً قائماً يطابق هذه الهوية"
      size="sm"
      dismissable={!loading}
      footer={
        // Full-width pair exactly like the pre-migration layout
        // (flex-1 buttons side by side), inside AppDialog's footer row.
        <div className="flex w-full gap-2.5">
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
            className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-2 press-spring active:scale-[0.97] shadow-md shadow-primary/22 disabled:opacity-60"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="w-4 h-4" aria-hidden="true" />
            )}
            {/* R123-E4b (P3-k): single-glyph ellipsis «…» (was ASCII "..."). */}
            {loading ? "جارٍ الربط…" : "تأكيد الربط"}
          </button>
        </div>
      }
    >
      <AppDialogBody className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-status-warning/10 border border-status-warning/22 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-status-warning" />
          </div>
          <div className="bg-muted/40 border border-border/60 rounded-xl p-3 flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">سيتم ربط هذا الحساب:</p>
            <p
              className="text-sm font-mono font-bold text-foreground"
              data-testid="link-consent-identifier"
              dir="ltr"
            >
              {identifier ?? "(حساب موجود)"}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          إذا لم يكن هذا حسابك، اختر <span className="font-bold">إلغاء</span> وتواصل مع الدعم.
          الموافقة تعني السماح بتسجيل الدخول لهذا الحساب عبر طريقة الدخول الجديدة.
        </p>
      </AppDialogBody>
    </AppDialog>
  );
}
