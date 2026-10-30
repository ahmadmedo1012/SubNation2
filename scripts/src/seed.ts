import argon2 from "argon2";
import { count, eq, sql } from "drizzle-orm";
import { loadLocalEnv } from "./runtime";
// The SAME slug generator the admin product-create route uses
// (backend/src/routes/admin/products.ts:216). Self-contained module (zero
// imports), safe to reuse here via tsx. Seeded products WITHOUT slugs look
// nothing like production's: /sitemap.xml skips them (no /product/<slug>
// entries), the PDP is unreachable, and the e2e cart/api families starve.
import { slugifyWithId } from "../../backend/src/lib/slugify";

// Load .env files BEFORE importing @workspace/db, which throws at module
// load time if DATABASE_URL is missing.
loadLocalEnv();
const { db, pool, usersTable, productsTable, adminUsersTable, loginAttemptsTable, inventoryTable } =
  await import("@workspace/db");

// Argon2id with the same OWASP-2024 parameters as backend/src/lib/crypto.ts —
// seeded admins previously landed on the legacy SHA-256 tier (valid but
// weakest hash, flagged needsRehash on first login).
async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function seed() {
  console.log("🌱 Starting SubNation database seed...\n");

  // ── Admin user ──────────────────────────────────────────────────────────────
  const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.ADMIN_PASSWORD;
  // F10 (round-94 A6): same guard as migrate.ts:1132-1137 — never bootstrap
  // (or RESET, via ADMIN_RESET_PASSWORD) a production superadmin with the
  // repository-known default password. Exiting loudly: a seed run against
  // a production DATABASE_URL must not half-execute.
  if (!adminPassword && process.env.NODE_ENV === "production") {
    console.error(
      "❌ Refusing to seed a default-password admin in production: set ADMIN_PASSWORD env (migrate.ts applies the same guard).",
    );
    process.exit(1);
  }
  const effectiveAdminPassword = adminPassword ?? "SubNation@2026";
  const resetAdminPassword = process.env.ADMIN_RESET_PASSWORD === "true";

  const [existingAdmin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, adminUsername))
    .limit(1);

  if (existingAdmin) {
    if (resetAdminPassword) {
      await db
        .update(adminUsersTable)
        .set({ passwordHash: await hashPassword(effectiveAdminPassword) })
        .where(eq(adminUsersTable.id, existingAdmin.id));
      await db
        .delete(loginAttemptsTable)
        .where(eq(loginAttemptsTable.identifier, `admin:${adminUsername}`));
      console.log(`✅ Admin '${adminUsername}' password reset`);
    } else {
      console.log(`✅ Admin '${adminUsername}' already exists — skipping`);
    }
  } else {
    // permissions: ["all"] — the first superadmin must be able to DO
    // things; the column default '[]' + the one-time RBAC backfill (which
    // runs before this insert) would otherwise lock a fresh install out
    // of every scoped route.
    await db.insert(adminUsersTable).values({
      username: adminUsername,
      passwordHash: await hashPassword(effectiveAdminPassword),
      displayName: "SubNation Admin",
      permissions: ["all"],
    });
    console.log(`✅ Created admin: ${adminUsername}`);
    console.log(`   ⚠️  Change this password after first login!\n`);
  }

  // ── Sample products ─────────────────────────────────────────────────────────
  const sampleProducts = [
    {
      name: "Netflix Premium",
      description: "نتفليكس بريميم — 4K + 4 شاشات متزامنة",
      category: "streaming",
      price: "45.00",
      isActive: true,
    },
    {
      name: "Spotify Premium",
      description: "سبوتيفاي بريميم — موسيقى بلا إعلانات وتحميل غير محدود",
      category: "music",
      price: "15.00",
      isActive: true,
    },
    {
      name: "PS Plus Essential",
      description: "بلايستيشن بلاس — ألعاب مجانية شهرياً ومتعدد اللاعبين",
      category: "gaming",
      price: "30.00",
      isActive: true,
    },
    {
      name: "Disney+",
      description: "ديزني بلاس — أفلام ومسلسلات ديزني وماربل وستار وورز",
      category: "streaming",
      price: "25.00",
      isActive: true,
    },
    {
      name: "Microsoft 365",
      description: "مايكروسوفت 365 — وورد وإكسيل وباوربوينت وتيمز",
      category: "productivity",
      price: "50.00",
      isActive: true,
    },
    {
      name: "Shahid VIP",
      description: "شاهد VIP — أفضل الدراما العربية والتركية المدبلجة",
      category: "streaming",
      price: "30.00",
      isActive: true,
    },
    {
      name: "Amazon Prime Video",
      description: "أمازون برايم فيديو — مسلسلات وأفلام حصرية عالمية",
      category: "streaming",
      price: "40.00",
      isActive: true,
    },
    {
      name: "PS Plus Deluxe",
      description: "بلايستيشن بلاس ديلوكس — مكتبة ألعاب ضخمة ومتعددة اللاعبين",
      category: "gaming",
      price: "60.00",
      isActive: true,
    },
  ];

  const existing = await db.select({ name: productsTable.name }).from(productsTable);
  const existingNames = new Set(existing.map((p) => p.name));

  let added = 0;
  for (const product of sampleProducts) {
    if (existingNames.has(product.name)) continue;
    // Mirror the admin create flow exactly: insert → slugify(name, id) →
    // update, with the id-suffixed fallback on a unique-violation — the
    // seeded catalog lands in the SAME shape production products have.
    const [inserted] = await db
      .insert(productsTable)
      .values({ ...product, imageUrl: null })
      .returning({ id: productsTable.id });
    let slug = slugifyWithId(product.name, inserted.id, /* withIdSuffix */ false);
    try {
      await db.update(productsTable).set({ slug }).where(eq(productsTable.id, inserted.id));
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        slug = slugifyWithId(product.name, inserted.id, /* withIdSuffix */ true);
        await db.update(productsTable).set({ slug }).where(eq(productsTable.id, inserted.id));
      } else {
        throw err;
      }
    }
    added++;
  }

  console.log(added > 0 ? `✅ Added ${added} products` : "✅ Products already exist — skipping");

  // ── Inventory: deliverable units so the catalog is BUYABLE ────────────
  // The available_only predicate (catalog.service.ts) counts inventory
  // rows (is_sold = false AND ≥1 credential field) — a seeded catalog
  // with zero units renders every product sold-out: /api/products?
  // available_only=true returns [], the guest cart families starve, and
  // the PDP shows «نفد المخزون» everywhere. The e2e guest suite is
  // read-only (no checkout), so the credential payloads are honest-shaped
  // placeholders — the encryption-at-rest path only engages at checkout.
  // ONE product stays deliberately unstocked (the last) so the sold-out
  // PDP honesty spec has a real candidate instead of skipping.
  const stocked = await db
    .select({ id: productsTable.id, name: productsTable.name })
    .from(productsTable)
    .orderBy(productsTable.id);
  const [{ count: unitCount }] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(eq(inventoryTable.isSold, false));
  if (unitCount === 0 && stocked.length > 1) {
    const toStock = stocked.slice(0, -1); // all but the last (sold-out candidate)
    for (const product of toStock) {
      for (let i = 1; i <= 3; i++) {
        await db.insert(inventoryTable).values({
          productId: product.id,
          accountEmail: `unit-${i}@${(product.name ?? "product").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "product"}.seed.local`,
          accountPassword: `seed-unit-${product.id}-${i}`,
          isSold: false,
        });
      }
    }
    console.log(
      `✅ Added ${toStock.length * 3} deliverable inventory units (3 per product; last product left sold-out)`,
    );
  } else if (unitCount > 0) {
    console.log(`✅ Inventory already stocked (${unitCount} unsold units) — skipping`);
  }

  // ── Auth providers: at least one enabled identity (OPT-IN) ────────────
  // /api/auth/providers reads system_settings rows keyed 'auth.<id>' and
  // returns ONLY enabled providers — a fresh boot creates every row with
  // enabled:false, so the api-contracts e2e family expects ≥1 enabled
  // identity and starves. GATED: SEED_ENABLE_AUTH_PROVIDERS=1 opts in
  // (the hermetic CI stack sets it; a production seed run NEVER flips a
  // live login provider on by default).
  if (process.env.SEED_ENABLE_AUTH_PROVIDERS === "1") {
    const current = await db.execute(
      sql`SELECT value FROM system_settings WHERE key = 'auth.google'`,
    );
    const currentRows = (current as unknown as { rows?: Array<{ value?: unknown }> }).rows ?? [];
    let merged: Record<string, unknown> = { enabled: true, firebase_enabled: true };
    if (currentRows.length > 0) {
      try {
        merged = {
          ...(JSON.parse(String(currentRows[0].value ?? "{}")) as Record<string, unknown>),
          enabled: true,
          // has_config for google = a non-secret field the providers filter
          // reads (firebase_enabled is the ONLY google field) — without it
          // the filter drops the provider even when enabled.
          firebase_enabled: true,
        };
      } catch {
        /* corrupt row — the fresh shape wins */
      }
    }
    await db.execute(
      sql`INSERT INTO system_settings (key, value, updated_at)
        VALUES ('auth.google', ${JSON.stringify(merged)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(merged)}, updated_at = NOW()`,
    );
    console.log(
      "✅ Enabled the Google auth provider (system_settings.auth.google — SEED_ENABLE_AUTH_PROVIDERS=1)",
    );
  } else {
    console.log(
      "ℹ️  Auth providers left as-booted (set SEED_ENABLE_AUTH_PROVIDERS=1 to enable google)",
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const [{ count: adminCount }] = await db.select({ count: count() }).from(adminUsersTable);
  const [{ count: productCount }] = await db.select({ count: count() }).from(productsTable);
  const [{ count: userCount }] = await db.select({ count: count() }).from(usersTable);
  const [{ count: unitCountFinal }] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(eq(inventoryTable.isSold, false));

  console.log("\n── Database Summary ────────────────────────────────");
  console.log(`   Admins:   ${adminCount ?? 0}`);
  console.log(`   Products: ${productCount ?? 0}`);
  console.log(`   Units:    ${unitCountFinal ?? 0} (unsold, deliverable)`);
  console.log(`   Users:    ${userCount ?? 0}`);
  console.log("────────────────────────────────────────────────────");
  console.log("\n✅ Seed complete!\n");

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
