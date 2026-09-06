import argon2 from "argon2";
import { count, eq } from "drizzle-orm";
import { loadLocalEnv } from "./runtime";

// Load .env files BEFORE importing @workspace/db, which throws at module
// load time if DATABASE_URL is missing.
loadLocalEnv();
const { db, pool, usersTable, productsTable, adminUsersTable, loginAttemptsTable } =
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
  const adminPassword = process.env.ADMIN_PASSWORD ?? "SubNation@2026";
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
        .set({ passwordHash: await hashPassword(adminPassword) })
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
      passwordHash: await hashPassword(adminPassword),
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
    if (!existingNames.has(product.name)) {
      await db.insert(productsTable).values({ ...product, imageUrl: null });
      added++;
    }
  }

  console.log(added > 0 ? `✅ Added ${added} products` : "✅ Products already exist — skipping");

  // ── Summary ─────────────────────────────────────────────────────────────────
  const [{ count: adminCount }] = await db.select({ count: count() }).from(adminUsersTable);
  const [{ count: productCount }] = await db.select({ count: count() }).from(productsTable);
  const [{ count: userCount }] = await db.select({ count: count() }).from(usersTable);

  console.log("\n── Database Summary ────────────────────────────────");
  console.log(`   Admins:   ${adminCount ?? 0}`);
  console.log(`   Products: ${productCount ?? 0}`);
  console.log(`   Users:    ${userCount ?? 0}`);
  console.log("────────────────────────────────────────────────────");
  console.log("\n✅ Seed complete!\n");

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
