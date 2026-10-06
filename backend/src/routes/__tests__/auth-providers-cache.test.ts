import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { createAdminSession } from "../../lib/admin-session";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { requirePermission } from "../../lib/permissions";
import { cacheDelete, cacheGet, cacheSet } from "../../lib/cache";
import { authProviderAdminRouter, authProviderPublicRouter } from "../auth-settings";

/**
 * R119-B2 — regression tests for the two auth-providers cache findings.
 *
 *   A3 F-1 / A5 F-1 (missing invalidation): the admin PATCH
 *   /api/admin/settings/auth/:id wrote the new config but never touched
 *   the "auth:providers:settings" cache entry the PUBLIC
 *   GET /api/auth/providers serves from (60 s cacheWrap window), so a
 *   disabled provider's login button lingered ~2+ min (60 s origin cache
 *   + 60 s SPA module cache) after the operator saved.
 *
 *   A3 F-2 (Map through JSON): getAllAuthSettings() returned a Map, and
 *   cacheSet persists via JSON.stringify — `JSON.stringify(new Map()) ===
 *   "{}"`. Dormant while production runs Redis-less (the memory fallback
 *   stores the reference unserialized), but the moment REDIS_URL is
 *   provisioned every cache HIT inside the TTL parsed "{}" back and the
 *   handler's `.get(...)` threw → 500 on the login page's provider list
 *   for the rest of each 60 s window.
 *
 * Harness: the real authProviderPublicRouter + authProviderAdminRouter
 * over the pglite fixture (system_settings ships in the shared DDL but is
 * NOT in its TRUNCATE list — cleared per-test here). The admin mount
 * mirrors routes/index.ts exactly: requireAdmin + requirePermission
 * ("settings") in front of the router.
 *
 * Cache seam: REDIS_URL is unset and the redis client is never
 * initialized, so cacheWrap/cacheGet/cacheSet exercise the REAL in-memory
 * LRU — exactly the production shape today. The round-trip test uses that
 * seam to push a JSON.parse(JSON.stringify(value)) payload back through
 * cacheSet, which is byte-for-byte what the Redis branch would return on
 * every read after a write.
 *
 * The cache key literal below ("auth:providers:settings") deliberately
 * re-states the value of AUTH_PROVIDERS_CACHE_KEY in routes/auth-settings.ts
 * — it is a deployment-visible contract, and a rename that misses either
 * site must fail here, not in production.
 */
const CACHE_KEY = "auth:providers:settings";

const TELEGRAM_CONFIG = {
  enabled: true,
  bot_username: "SubNationTestBot",
  // Numeric prefix (>= 6 digits) is what the providers handler derives
  // bot_id from — the public entry only renders when it parses.
  bot_token: "1234567890:AAH-test-bot-token-not-real-do-not-reuse",
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authProviderPublicRouter);
  // Production mount (routes/index.ts:59): the admin router sits behind
  // requireAdmin + requirePermission("settings").
  app.use(
    "/api/admin/settings",
    requireAdmin,
    requirePermission("settings"),
    authProviderAdminRouter,
  );
  // Minimal mirror of app.ts's global error handler: a thrown TypeError in
  // an async handler must surface as a clean 500 JSON (Express 5 forwards
  // async rejections to error middleware), not a hung socket.
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message || "server_error" });
    },
  );
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

interface ProviderEntry {
  id: string;
  enabled: boolean;
  has_config: boolean;
  client_id: string | null;
  app_id: string | null;
  bot_username: string | null;
  bot_id: string | null;
}

interface ProvidersResponse {
  status: number;
  headers: Headers;
  body: { providers: ProviderEntry[]; whatsapp_enabled: boolean; whatsapp_status: string | null };
}

async function getProviders(url: string): Promise<ProvidersResponse> {
  const res = await fetch(`${url}/api/auth/providers`);
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as ProvidersResponse["body"],
  };
}

async function patchProvider(
  url: string,
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/settings/auth/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

async function getAdminSettings(
  url: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/settings/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "auth_settings_admin",
      passwordHash: "x",
      isActive: true,
      // The scope the production mount requires (routes/index.ts).
      permissions: ["settings"],
    })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  return token;
}

async function seedTelegramSetting(): Promise<void> {
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify(TELEGRAM_CONFIG)})`,
  );
}

function providerIds(body: ProvidersResponse["body"]): string[] {
  return body.providers.map((p) => p.id);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  // system_settings is NOT in the shared TRUNCATE list — clear it here so
  // no case sees another case's provider config.
  await db.execute(sql.raw("DELETE FROM system_settings;"));
  // The memory LRU under lib/cache.ts is PROCESS state — evict the
  // providers entry so every case starts cold, not on a leftover payload.
  await cacheDelete(CACHE_KEY);
});

describe("R119-B2 — auth providers cache (public GET vs admin PATCH)", () => {
  it("A3 F-1: PATCHing a provider to disabled is visible on the NEXT public read — no 60 s TTL wait", async () => {
    await seedTelegramSetting();
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      // 1. Warm the public cache with the enabled provider.
      const first = await getProviders(url);
      expect(first.status).toBe(200);
      expect(providerIds(first.body)).toContain("telegram");
      expect(first.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      );

      // Prove the read actually populated the cache entry — otherwise the
      // post-PATCH read below could pass vacuously by re-running the
      // loader on a miss it caused itself. (Shape is pinned in the F-2
      // test; here only residency matters, so the assertion stays
      // shape-agnostic and isolates the invalidation concern.)
      const cached = await cacheGet(CACHE_KEY);
      expect(cached).not.toBeNull();

      // 2. Disable it as the operator would. The PATCH schema requires
      // every provider field key (the admin UI always submits the full
      // form); the secret goes back as the "[SET]" sentinel, which the
      // handler skips so the stored bot_token is preserved.
      const patch = await patchProvider(url, token, "telegram", {
        enabled: false,
        bot_username: TELEGRAM_CONFIG.bot_username,
        bot_token: "[SET]",
      });
      expect(patch.status).toBe(200);
      expect(patch.body).toMatchObject({ id: "telegram", enabled: false });

      // The invalidation is real: the entry the first GET created is gone.
      expect(await cacheGet(CACHE_KEY)).toBeNull();

      // 3. THE REGRESSION: the very next public read reflects the
      // mutation. With the memory LRU the 60 s TTL has NOT elapsed, so
      // this only passes because the PATCH deleted the key — without the
      // invalidation the stale enabled entry would be served verbatim and
      // the telegram login button would keep rendering.
      const second = await getProviders(url);
      expect(second.status).toBe(200);
      expect(providerIds(second.body)).not.toContain("telegram");
    } finally {
      close();
    }
  });

  it("A3 F-2: the cached payload is a plain object and survives the JSON round-trip (the Redis wire shape) — no Map, no 500", async () => {
    await seedTelegramSetting();
    const { url, close } = await listen(buildApp());
    try {
      // 1. Warm the cache with a live request.
      const first = await getProviders(url);
      expect(first.status).toBe(200);
      expect(providerIds(first.body)).toContain("telegram");

      // 2. Shape pin: the cached value is a PLAIN OBJECT keyed by setting
      // key — never a Map. The old getAllAuthSettings returned a Map
      // (which the memory backend stored by reference, so this very
      // assertion would have failed on it), and on the Redis branch
      // cacheSet's JSON.stringify would have collapsed it to "{}".
      const cached = await cacheGet<Record<string, Record<string, unknown>>>(CACHE_KEY);
      expect(cached).not.toBeNull();
      expect(cached).not.toBeInstanceOf(Map);
      expect((cached as Record<string, Record<string, unknown>>)["auth.telegram"]).toMatchObject({
        enabled: true,
        bot_username: TELEGRAM_CONFIG.bot_username,
      });

      // 3. Simulate the Redis path exactly: setEx stores
      // JSON.stringify(value); every subsequent GET returns JSON.parse of
      // that. Push the round-tripped value back through the same cache
      // surface, then read it through the real handler. With the Map
      // return type this was `"{}".get(...)` → TypeError → 500 on the
      // login page's provider list for the rest of each 60 s window.
      const roundTripped = JSON.parse(JSON.stringify(cached));
      await cacheSet(CACHE_KEY, roundTripped, 60);

      const second = await getProviders(url);
      expect(second.status).toBe(200);
      expect(providerIds(second.body)).toContain("telegram");
      const telegram = second.body.providers.find((p) => p.id === "telegram");
      expect(telegram).toMatchObject({
        enabled: true,
        has_config: true,
        bot_username: TELEGRAM_CONFIG.bot_username,
        // Derived server-side from the bot_token prefix — proves the
        // lookup semantics (index access ?? {}) kept working end-to-end.
        bot_id: "1234567890",
      });
    } finally {
      close();
    }
  });

  it("A3 F-2 (admin consumer): GET /api/admin/settings/auth reads the same plain-object shape — masked config intact", async () => {
    await seedTelegramSetting();
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await getAdminSettings(url, token);
      expect(res.status).toBe(200);
      const providers = (res.body?.providers ?? []) as Array<
        Record<string, unknown> & { id: string; enabled: boolean }
      >;
      const telegram = providers.find((p) => p.id === "telegram");
      expect(telegram).toBeDefined();
      expect(telegram!.enabled).toBe(true);
      // Secrets stay masked on the admin surface (bot_token → "[SET]");
      // the public field survives the Record conversion unchanged.
      expect(telegram!.config).toMatchObject({
        bot_username: TELEGRAM_CONFIG.bot_username,
        bot_token: "[SET]",
      });
    } finally {
      close();
    }
  });
});
