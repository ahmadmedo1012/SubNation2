import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./lib/logger";

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "subnation_salt").digest("hex");
}

export async function runMigrations() {
  try {
    // ── Enums ──────────────────────────────────────────────────────────────
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
          CREATE TYPE order_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'topup_status') THEN
          CREATE TYPE topup_status AS ENUM ('pending', 'approved', 'rejected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
          CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'closed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_type') THEN
          CREATE TYPE coupon_type AS ENUM ('percentage', 'fixed');
        END IF;
      END $$;
    `);

    // ── Core tables ─────────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        phone          VARCHAR(20) NOT NULL UNIQUE,
        password_hash  VARCHAR(255) NOT NULL DEFAULT '',
        google_id      VARCHAR(255) UNIQUE,
        wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        loyalty_points INTEGER NOT NULL DEFAULT 0,
        loyalty_tier   VARCHAR(50) NOT NULL DEFAULT 'bronze',
        lifetime_spend NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        referral_code  VARCHAR(20) UNIQUE,
        referred_by    INTEGER,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name  VARCHAR(100) NOT NULL DEFAULT 'Admin',
        role          VARCHAR(50) NOT NULL DEFAULT 'admin',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS products (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        description  TEXT,
        image_url    VARCHAR(1000),
        price        NUMERIC(10,2) NOT NULL,
        category     VARCHAR(100),
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
        usage_terms  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory (
        id               SERIAL PRIMARY KEY,
        product_id       INTEGER NOT NULL,
        account_email    VARCHAR(255),
        account_password VARCHAR(255),
        extra_details    TEXT,
        is_sold          BOOLEAN NOT NULL DEFAULT FALSE,
        sold_at          TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS orders (
        id                    SERIAL PRIMARY KEY,
        order_code            VARCHAR(50) NOT NULL UNIQUE,
        user_id               INTEGER NOT NULL,
        product_id            INTEGER NOT NULL,
        inventory_id          INTEGER,
        amount                NUMERIC(10,2) NOT NULL,
        wallet_balance_before NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        wallet_balance_after  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        status                order_status NOT NULL DEFAULT 'pending',
        delivered_email       VARCHAR(255),
        delivered_password    VARCHAR(255),
        delivered_extra_details TEXT,
        delivered_usage_terms TEXT,
        delivered_at          TIMESTAMPTZ,
        coupon_code           VARCHAR(50),
        discount_amount       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wallet_topups (
        id                SERIAL PRIMARY KEY,
        user_id           INTEGER NOT NULL,
        amount            NUMERIC(10,2) NOT NULL,
        payment_method    VARCHAR(50) NOT NULL DEFAULT 'mobile_transfer',
        payment_network   VARCHAR(50),
        sender_phone      VARCHAR(20),
        sender_account    VARCHAR(255),
        payment_reference VARCHAR(255),
        status            topup_status NOT NULL DEFAULT 'pending',
        admin_note        TEXT,
        reviewed_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        type       VARCHAR(20) NOT NULL DEFAULT 'system',
        title      VARCHAR(255) NOT NULL,
        message    TEXT,
        link       VARCHAR(255),
        is_read    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        title      VARCHAR(255) NOT NULL,
        category   VARCHAR(50),
        status     ticket_status NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id          SERIAL PRIMARY KEY,
        ticket_id   INTEGER NOT NULL,
        author_type VARCHAR(10) NOT NULL DEFAULT 'user',
        message     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_events (
        id          SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL,
        referee_id  INTEGER NOT NULL UNIQUE,
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        credited_at TIMESTAMPTZ
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS flash_sales (
        id               SERIAL PRIMARY KEY,
        title            VARCHAR(255) NOT NULL DEFAULT 'Flash Sale',
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
        ends_at          TIMESTAMPTZ NOT NULL,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id               SERIAL PRIMARY KEY,
        code             VARCHAR(50) NOT NULL UNIQUE,
        type             coupon_type NOT NULL DEFAULT 'percentage',
        value            NUMERIC(10,2) NOT NULL,
        min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        max_uses         INTEGER,
        used_count       INTEGER NOT NULL DEFAULT 0,
        expires_at       TIMESTAMPTZ,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        description      VARCHAR(255),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id         SERIAL PRIMARY KEY,
        type       VARCHAR(30) NOT NULL DEFAULT 'system',
        title      VARCHAR(255) NOT NULL,
        message    TEXT,
        is_read    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Idempotent column additions (for upgrades on existing DBs) ──────────
    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS coupon_code     VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;
    `);

    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS github_id   VARCHAR(255) UNIQUE,
        ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(255) UNIQUE,
        ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(255) UNIQUE;
    `);

    // ── Seed: default auth provider configs (no-op if already set) ──────────
    const providerDefaults = [
      ["auth.google",   JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.github",   JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.facebook", JSON.stringify({ enabled: false, app_id: "", app_secret: "" })],
      ["auth.telegram", JSON.stringify({ enabled: false, bot_username: "", bot_token: "" })],
      ["auth.apple",    JSON.stringify({ enabled: false, client_id: "", team_id: "", key_id: "", private_key: "" })],
    ];
    for (const [key, value] of providerDefaults) {
      await db.execute(sql`
        INSERT INTO system_settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── Seed: Admin user ────────────────────────────────────────────────────
    const adminCountResult = await db.execute(sql`SELECT COUNT(*) as c FROM admin_users`);
    const adminCount = (adminCountResult as any).rows?.[0] ?? (adminCountResult as any)[0];
    if (Number(adminCount?.c ?? adminCount?.count ?? 0) === 0) {
      await db.execute(sql`
        INSERT INTO admin_users (username, password_hash, display_name, role)
        VALUES ('admin', ${hashPassword("admin123")}, 'مدير النظام', 'superadmin')
      `);
      logger.info("Default admin user created — username: admin / password: admin123");
    }

    // ── Seed: Products ──────────────────────────────────────────────────────
    const productCountResult = await db.execute(sql`SELECT COUNT(*) as c FROM products`);
    const productCount = (productCountResult as any).rows?.[0] ?? (productCountResult as any)[0];
    if (Number(productCount?.c ?? productCount?.count ?? 0) < 12) {
      const products = [
        {
          name: "Netflix Premium",
          description: "استمتع بأفلام ومسلسلات عالمية بجودة 4K UHD على 4 شاشات في نفس الوقت. أفضل تجربة بث في العالم.",
          image_url: null,
          price: "14.99",
          category: "streaming",
          usage_terms: "لا تغيّر كلمة المرور أو البريد الإلكتروني. استخدام الحساب بشكل شخصي فقط.",
        },
        {
          name: "Spotify Premium",
          description: "استمع إلى ملايين الأغاني والبودكاست بدون إعلانات وبجودة صوت عالية. مناسب للأجهزة المحمولة والحاسوب.",
          image_url: null,
          price: "5.99",
          category: "music",
          usage_terms: "عدم مشاركة الحساب مع الغير. استخدام على جهاز واحد.",
        },
        {
          name: "Disney+ Standard",
          description: "محتوى ديزني وماريل وبيكسار وناشيونال جيوغرافيك وحرب النجوم — كل شيء في مكان واحد.",
          image_url: null,
          price: "9.99",
          category: "streaming",
          usage_terms: "حساب شخصي. لا يسمح بتغيير بيانات الحساب.",
        },
        {
          name: "YouTube Premium",
          description: "شاهد يوتيوب بدون إعلانات، حمّل الفيديوهات للمشاهدة بدون إنترنت، واستمتع بـ YouTube Music مجاناً.",
          image_url: null,
          price: "6.99",
          category: "streaming",
          usage_terms: "استخدم بريدك الشخصي للدخول إلى الحساب.",
        },
        {
          name: "PlayStation Plus Essential",
          description: "العب أونلاين مع أصدقائك واحصل على ألعاب شهرية مجانية وخصومات حصرية على متجر PlayStation.",
          image_url: null,
          price: "17.99",
          category: "gaming",
          usage_terms: "مفتاح تفعيل رقمي — لا يُرجع بعد الاسترداد.",
        },
        {
          name: "Xbox Game Pass Ultimate",
          description: "مكتبة ضخمة من الألعاب لأجهزة Xbox وPC، بالإضافة إلى EA Play وخدمة اللعب السحابي.",
          image_url: null,
          price: "19.99",
          category: "gaming",
          usage_terms: "رمز تفعيل لمدة شهر. لا يُرجع بعد الاستخدام.",
        },
        {
          name: "Canva Pro",
          description: "أداة التصميم الاحترافية — قوالب لا محدودة، إزالة الخلفيات، تصدير بجودة عالية، وتعاون مع الفريق.",
          image_url: null,
          price: "7.99",
          category: "productivity",
          usage_terms: "سيتم إرسال دعوة إلى بريدك الإلكتروني. لا تشارك الحساب.",
        },
        {
          name: "Microsoft 365 Personal",
          description: "احصل على Word وExcel وPowerPoint وOneDrive بسعة 1TB. مثالي للعمل والدراسة.",
          image_url: null,
          price: "12.99",
          category: "productivity",
          usage_terms: "مفتاح تفعيل رقمي لسنة كاملة. لجهاز واحد فقط.",
        },
        {
          name: "NordVPN 1 شهر",
          description: "حماية كاملة لخصوصيتك على الإنترنت. سرعة فائقة، 6000+ خادم حول العالم، بدون تسجيل بيانات.",
          image_url: null,
          price: "8.99",
          category: "productivity",
          usage_terms: "رمز تفعيل. يُستخدم على جهازين في آن واحد.",
        },
        {
          name: "Apple TV+",
          description: "أفلام ومسلسلات Apple الأصلية الحصرية بجودة 4K HDR. محتوى جديد كل أسبوع.",
          image_url: null,
          price: "4.99",
          category: "streaming",
          usage_terms: "حساب مشترك. لا تغيّر بيانات الدخول.",
        },
        {
          name: "Adobe Creative Cloud",
          description: "جميع تطبيقات Adobe — Photoshop وIllustrator وPremiere وAfter Effects وأكثر من 20 تطبيق احترافي.",
          image_url: null,
          price: "24.99",
          category: "productivity",
          usage_terms: "حساب شخصي مؤقت. لا تغيّر كلمة المرور.",
        },
        {
          name: "Crunchyroll Premium",
          description: "شاهد أحدث الأنمي فور بثّه في اليابان بدون إعلانات وبجودة 1080p. أكبر مكتبة أنمي في العالم.",
          image_url: null,
          price: "4.49",
          category: "streaming",
          usage_terms: "حساب مشترك. استخدم البروفايل المخصص لك.",
        },
      ];

      for (const p of products) {
        // Insert product only if name doesn't already exist
        const existRes = await db.execute(sql`SELECT id FROM products WHERE name = ${p.name} LIMIT 1`);
        const existRow = (existRes as any).rows?.[0] ?? (existRes as any)[0];
        let productId: number;

        if (existRow?.id) {
          productId = existRow.id;
        } else {
          const insertedResult = await db.execute(sql`
            INSERT INTO products (name, description, image_url, price, category, is_active, is_archived, usage_terms)
            VALUES (${p.name}, ${p.description}, ${p.image_url}, ${p.price}, ${p.category}, true, false, ${p.usage_terms})
            RETURNING id
          `);
          const insertedRow = (insertedResult as any).rows?.[0] ?? (insertedResult as any)[0];
          productId = (insertedRow as any).id;
        }

        // Add inventory items if this product has fewer than 5 unsold units
        const invRes = await db.execute(sql`SELECT COUNT(*) as c FROM inventory WHERE product_id = ${productId} AND is_sold = false`);
        const invRow = (invRes as any).rows?.[0] ?? (invRes as any)[0];
        const invCount = Number(invRow?.c ?? 0);

        if (invCount < 5) {
          const toAdd = 5 - invCount;
          for (let i = 1; i <= toAdd; i++) {
            const emailNum = String(productId * 100 + invCount + i).padStart(5, "0");
            await db.execute(sql`
              INSERT INTO inventory (product_id, account_email, account_password, extra_details, is_sold)
              VALUES (
                ${productId},
                ${`sub${emailNum}@subnation.ly`},
                ${`SN${emailNum}@Pass`},
                ${"احتفظ ببيانات الدخول في مكان آمن. لا تشاركها مع أحد."},
                false
              )
            `);
          }
        }
      }

      logger.info("Sample products and inventory seeded successfully");

      // Seed a welcome coupon
      await db.execute(sql`
        INSERT INTO coupons (code, type, value, min_order_amount, max_uses, is_active, description)
        VALUES ('WELCOME10', 'percentage', 10.00, 0.00, 100, true, 'خصم 10% للمستخدمين الجدد')
        ON CONFLICT (code) DO NOTHING
      `);

      logger.info("Welcome coupon WELCOME10 created");
    }

    // ── Fix: clear any broken wikimedia image URLs ───────────────────────────
    await db.execute(sql`
      UPDATE products SET image_url = NULL WHERE image_url LIKE '%wikimedia%' OR image_url LIKE '%wikipedia%'
    `);

    logger.info("Migrations completed");
  } catch (err) {
    logger.error({ err }, "Startup migration failed");
  }
}
