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
 * ── PLACEHOLDER DISCIPLINE (owner actions, R191) ─────────────────────────
 *
 * Both files ship with placeholder credentials that MUST be replaced before
 * the corresponding platform will actually open the app (until then the OS
 * falls back to opening the web page — the routes/JSON are correct, the
 * association is simply not yet attestable):
 *
 *   • assetlinks.json — the SHA256 of the Play App Signing cert is NOT
 *     knowable until EAS generates the Android production credentials.
 *     After the first EAS Android production build the owner runs
 *     `eas credentials` (Android section → fingerprint) and replaces
 *     PLACEHOLDER_SHA256_WHEN_EAS_SIGNS with the real
 *     AA:BB:… colon-hex SHA256 fingerprint.
 *   • apple-app-site-association — TEAMID is the Apple Developer
 *     Program's Team ID (membership page), swapped into
 *     "TEAMID.ly.subnation.app" once known.
 *
 * Recorded as pending operator actions in OPERATIONS_RUNBOOK.md §14.
 */

const router = Router();

// Android App Links statement (developers.google.com/digital-asset-links).
// PLACEHOLDER_SHA256_WHEN_EAS_SIGNS: replaced by the owner with the Play
// signing cert's SHA256 after the first EAS Android production build
// (eas credentials reveals it) — see the module doc above.
const ASSET_LINKS_BODY = JSON.stringify(
  [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "ly.subnation.app",
        sha256_cert_fingerprints: ["PLACEHOLDER_SHA256_WHEN_EAS_SIGNS"],
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
