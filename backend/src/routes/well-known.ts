import { Router } from "express";

/**
 * R191 (backend mobile contracts) — /.well-known deep-link association files.
 *
 * Android App Links (assetlinks.json) and iOS Universal Links
 * (apple-app-site-association — the PATH carries NO .json suffix, Apple's
 * verifier requires the bare name) are machine-facing static JSON the OS
 * link verifiers fetch from the site apex. Same serving shape as
 * routes/seo.ts (robots.txt/sitemap.xml): root-level, public, long public
 * cache, no CSRF/auth — the CSRF Origin gate only covers
 * POST/PUT/DELETE/PATCH and these are GET static JSON.
 *
 * ── CREDENTIAL DISCIPLINE (owner actions, R191 + the PR-hardening wave) ──
 *
 * Android App Links (assetlinks.json):
 *   • The EAS-managed keystore's SHA256 is IN THE FILE (extracted from
 *     the signed artifacts themselves — the dev APK and the production
 *     AAB carry the SAME signer, byte-identical fingerprints; EAS signs
 *     every Android build with the one project keystore). App Links
 *     verification therefore SUCCEEDS for sideloaded dev/preview
 *     installs the moment this file deploys.
 *   • PLACEHOLDER_PLAY_APP_SIGNING_SHA256 remains: Google Play App
 *     Signing re-signs production installs with Google's own key — its
 *     SHA256 comes from Play Console (Release → Setup → App signing)
 *     once the owner creates the app entry. APPEND it to the array
 *     (keep the EAS fingerprint — dev builds keep verifying against
 *     it), then redeploy.
 *
 * iOS Universal Links (apple-app-site-association):
 *   • TEAMID is the Apple Developer Program's Team ID (membership
 *     page), swapped into "TEAMID.ly.subnation.app" once known.
 *
 * Recorded as pending operator actions in OPERATIONS_RUNBOOK.md §14.
 */

const router = Router();

// Android App Links statement (developers.google.com/digital-asset-links).
// The EAS keystore SHA256 was extracted from the signed artifacts (the dev
// APK's v2 signing block and the production AAB's JAR signature agree
// byte-for-byte); PLACEHOLDER_PLAY_APP_SIGNING_SHA256 awaits Play Console's
// app-signing key — see the module doc above.
const ASSET_LINKS_BODY = JSON.stringify(
  [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "ly.subnation.app",
        sha256_cert_fingerprints: [
          // The EAS-managed Android keystore — signs EVERY EAS build
          // (dev APK + production AAB; verified identical on both
          // artifacts). Dev/preview installs verify App Links against
          // THIS fingerprint.
          "5D:D2:D9:0C:A5:33:3B:7A:3D:60:14:17:E5:B2:A7:14:95:DC:31:E9:DD:E8:BD:35:29:79:3A:6F:55:33:A9:AC",
          // Google Play App Signing's key — the owner appends the real
          // SHA256 from Play Console (Release → Setup → App signing)
          // after creating the app entry; production Play installs
          // verify against that one.
          "PLACEHOLDER_PLAY_APP_SIGNING_SHA256",
        ],
      },
    },
  ],
  null,
  2,
);

router.get("/.well-known/assetlinks.json", (_req, res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  // 7d public cache — the file changes once per credential lifecycle; the
  // OS verifiers re-fetch on their own cadence regardless.
  res.set("Cache-Control", "public, max-age=604800, immutable");
  res.send(ASSET_LINKS_BODY);
});

// iOS Universal Links statement (developer.apple.com — the path MUST be
// exactly /.well-known/apple-app-site-association with NO extension).
// TEAMID: replaced by the owner with the Apple Developer Team ID once
// known — see the module doc above.
const APPLE_APP_SITE_ASSOCIATION_BODY = JSON.stringify(
  {
    applinks: {
      details: [
        {
          appIDs: ["TEAMID.ly.subnation.app"],
          components: [
            { comment: "Products", path: "/product/*" },
            { comment: "Categories", path: "/category/*" },
            { comment: "Orders", path: "/orders/*" },
          ],
        },
      ],
    },
  },
  null,
  2,
);

router.get("/.well-known/apple-app-site-association", (_req, res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "public, max-age=604800, immutable");
  res.send(APPLE_APP_SITE_ASSOCIATION_BODY);
});

// R158 (B#9): the layer's majority export convention
// (export { router as xRouter }).
export { router as wellKnownRouter };
