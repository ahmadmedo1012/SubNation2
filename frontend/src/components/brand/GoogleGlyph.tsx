/**
 * Google brand glyph — the multi-color "G" (viewBox 0 0 18 18, the
 * four official fills #4285F4 / #34A853 / #FBBC05 / #EA4335).
 *
 * R167-C (F17 — the R166 audit's brand-glyph extraction): this exact
 * SVG was hand-drawn at two call sites (the AuthProviders provider
 * rows and the admin settings provider card); the four paths are
 * byte-identical at both sites and live HERE once.
 *
 * Render contract (byte-identical to every pre-extraction site):
 * `size` drives the square width/height (18 storefront buttons /
 * 20 admin rows); `className` and `aria-hidden` are OPT-IN so each
 * call site reproduces exactly the markup it had — neither site ever
 * carried aria-hidden, and they still don't.
 */
interface GoogleGlyphProps {
  /** Square render size in px (defaults to the storefront button's 18). */
  size?: number;
  className?: string;
  /** Decorative call sites (inside labeled buttons/rows) opt in. */
  "aria-hidden"?: boolean;
}

export function GoogleGlyph({
  size = 18,
  className,
  "aria-hidden": ariaHidden,
}: GoogleGlyphProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden={ariaHidden ? "true" : undefined}
      className={className}
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
