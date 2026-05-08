import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { loadLocalEnv } from "./runtime";

// Load .env files BEFORE importing @workspace/db, which throws at module
// load time if DATABASE_URL is missing.
loadLocalEnv();
const { db, pool, usersTable, productsTable, adminUsersTable } =
  await import("@workspace/db");

function hashPassword(password: string): string {
  return createHash("sha256")
    .update(password + "subnation_salt")
    .digest("hex");
}

async function seed() {
  console.log("🌱 Starting SubNation database seed...\n");

  // ── Admin user ──────────────────────────────────────────────────────────────
  const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "SubNation@2026";

  const [existingAdmin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, adminUsername))
    .limit(1);

  if (existingAdmin) {
    console.log(`✅ Admin '${adminUsername}' already exists — skipping`);
  } else {
    await db.insert(adminUsersTable).values({
      username: adminUsername,
      passwordHash: hashPassword(adminPassword),
      displayName: "SubNation Admin",
    });
    console.log(`✅ Created admin: ${adminUsername} / ${adminPassword}`);
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

  const existing = await db
    .select({ name: productsTable.name })
    .from(productsTable);
  const existingNames = new Set(existing.map((p) => p.name));

  let added = 0;
  for (const product of sampleProducts) {
    if (!existingNames.has(product.name)) {
      await db.insert(productsTable).values({ ...product, imageUrl: null });
      added++;
    }
  }

  console.log(
    added > 0
      ? `✅ Added ${added} products`
      : "✅ Products already exist — skipping",
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  const [{ count: adminCount }] = await db
    .select({ count: adminUsersTable.id })
    .from(adminUsersTable);
  const [{ count: productCount }] = await db
    .select({ count: productsTable.id })
    .from(productsTable);
  const [{ count: userCount }] = await db
    .select({ count: usersTable.id })
    .from(usersTable);

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
