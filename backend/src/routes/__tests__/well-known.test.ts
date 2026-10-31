import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";

/**
 * R191 review (R7-b P3-1): routes/well-known.ts — the OS deep-link
 * association files — had ZERO tests (the parity gate allowlists the
 * two routes as internal, so nothing pinned their contracts). A future
 * refactor could silently break Android/iOS link verification while
 * every other gate stayed green.
 *
 * Pinned contracts (the shapes developers.google.com/digital-asset-links
 * and developer.apple.com's AASA verifier require):
 *   - /.well-known/assetlinks.json: application/json; charset=utf-8,
 *     the 7-day public immutable cache, the exact Android statement
 *     (delegate_permission/common.handle_all_urls, android_app namespace,
 *     package ly.subnation.app) with the REAL EAS keystore SHA256 (the
 *     fingerprint extracted from the signed artifacts — a keystore
 *     rotation must consciously re-pin this suite) plus the Play App
 *     Signing placeholder that remains an owner action;
 *   - /.well-known/apple-app-site-association: the BARE path (no .json
 *     suffix — Apple's verifier requires exactly this name),
 *     application/json; charset=utf-8, the same cache family, the
 *     applinks.details appIDs/components shape with the app's three
 *     shareable path families (product/category/orders — each one has
 *     a matching in-app route incl. the /orders/[orderCode] web-URL
 *     alias);
 *   - both files carry their remaining PLACEHOLDER credentials (the
 *     documented owner actions) — the placeholders are pinned by name
 *     so a swap is a conscious act that updates this suite too;
 *   - unknown /.well-known/* paths 404 (nothing else is exposed).
 */

let wellKnownRouter: (typeof import("../well-known"))["wellKnownRouter"];

beforeAll(async () => {
  const mod = await import("../well-known");
  wellKnownRouter = mod.wellKnownRouter;
});

function buildApp(): Express {
  const app = express();
  app.use("/", wellKnownRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function get(url: string, path: string) {
  const res = await fetch(`${url}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
    text: await res.text(),
  };
}

describe("R191 (backend mobile contracts): /.well-known deep-link association files", () => {
  it("assetlinks.json — the exact Android App Links statement, content type, and cache", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, "/.well-known/assetlinks.json");
      expect(res.status).toBe(200);
      expect(res.contentType).toBe("application/json; charset=utf-8");
      expect(res.cacheControl).toBe("public, max-age=604800, immutable");

      const body = JSON.parse(res.text) as Array<{
        relation: string[];
        target: {
          namespace: string;
          package_name: string;
          sha256_cert_fingerprints: string[];
        };
      }>;
      expect(body).toHaveLength(1);
      expect(body[0]!.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
      expect(body[0]!.target.namespace).toBe("android_app");
      expect(body[0]!.target.package_name).toBe("ly.subnation.app");
      // Two fingerprint slots: the REAL EAS keystore (extracted from the
      // signed artifacts — dev APK and production AAB agree byte-for-byte;
      // pinned by value so a keystore rotation re-pins this suite) + the
      // Play App Signing placeholder (the owner's remaining action).
      expect(body[0]!.target.sha256_cert_fingerprints).toEqual([
        "5D:D2:D9:0C:A5:33:3B:7A:3D:60:14:17:E5:B2:A7:14:95:DC:31:E9:DD:E8:BD:35:29:79:3A:6F:55:33:A9:AC",
        "PLACEHOLDER_PLAY_APP_SIGNING_SHA256",
      ]);
    } finally {
      close();
    }
  });

  it("apple-app-site-association — the BARE path, the applinks shape, and the app's path families", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, "/.well-known/apple-app-site-association");
      expect(res.status).toBe(200);
      // Apple's verifier fetches the bare name — no .json suffix.
      expect(res.contentType).toBe("application/json; charset=utf-8");
      expect(res.cacheControl).toBe("public, max-age=604800, immutable");

      const body = JSON.parse(res.text) as {
        applinks: {
          details: Array<{
            appIDs: string[];
            components: Array<{ comment?: string; path: string }>;
          }>;
        };
      };
      expect(body.applinks.details).toHaveLength(1);
      expect(body.applinks.details[0]!.appIDs).toEqual(["TEAMID.ly.subnation.app"]);
      const paths = body.applinks.details[0]!.components.map((c) => c.path);
      // Every claimed path family has a matching in-app route (the
      // /orders/* web-URL alias landed with this review round).
      expect(paths).toEqual(["/product/*", "/category/*", "/orders/*"]);
    } finally {
      close();
    }
  });

  it("unknown /.well-known/* paths are a plain 404 — nothing else is exposed", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, "/.well-known/apple-app-site-association.json");
      // The .json-suffixed twin must NOT exist (Apple's spec-name rule).
      expect(res.status).toBe(404);
      const other = await get(url, "/.well-known/nothing-here");
      expect(other.status).toBe(404);
    } finally {
      close();
    }
  });
});
