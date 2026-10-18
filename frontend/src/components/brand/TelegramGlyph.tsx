/**
 * Telegram brand glyph — the paper plane, fill #2AABEE.
 *
 * R167-C (F17 — the R166 audit's brand-glyph extraction): this exact
 * SVG was hand-drawn at four call sites (TelegramLoginButton, the
 * AuthProviders provider rows, the profile linked-accounts row, and
 * the admin settings provider card); the path is byte-identical at
 * every site and lives HERE once. Apple stays inline where it is (a
 * single site, not a duplicate).
 *
 * Render contract (byte-identical to every pre-extraction site):
 * `size` drives the square width/height (18 storefront buttons /
 * 20 admin rows / 16 profile rows); `className` and `aria-hidden`
 * are OPT-IN so each call site reproduces exactly the markup it had —
 * the AuthProviders ICONS map and the admin card never carried
 * aria-hidden, and they still don't.
 */
interface TelegramGlyphProps {
  /** Square render size in px (defaults to the storefront button's 18). */
  size?: number;
  className?: string;
  /** Decorative call sites (inside labeled buttons/rows) opt in. */
  "aria-hidden"?: boolean;
}

export function TelegramGlyph({
  size = 18,
  className,
  "aria-hidden": ariaHidden,
}: TelegramGlyphProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#2AABEE"
      aria-hidden={ariaHidden ? "true" : undefined}
      className={className}
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
    </svg>
  );
}
