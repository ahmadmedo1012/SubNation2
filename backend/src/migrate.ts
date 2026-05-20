import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "./lib/crypto";
import { encrypt, isEncrypted } from "./lib/encryption";
import { logger } from "./lib/logger";

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
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
          CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_entry_type') THEN
          CREATE TYPE ledger_entry_type AS ENUM ('topup', 'purchase', 'refund', 'adjustment', 'referral_credit');
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
        github_id      VARCHAR(255) UNIQUE,
        facebook_id    VARCHAR(255) UNIQUE,
        telegram_id    VARCHAR(255) UNIQUE,
        firebase_uid   VARCHAR(255) UNIQUE,
        email          VARCHAR(255),
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        display_name   VARCHAR(255),
        photo_url      TEXT,
        auth_provider  VARCHAR(50) NOT NULL DEFAULT 'legacy_password',
        password_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        legacy_password_disabled_at TIMESTAMPTZ,
        last_auth_at   TIMESTAMPTZ,
        wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        loyalty_points INTEGER NOT NULL DEFAULT 0,
        loyalty_tier   VARCHAR(50) NOT NULL DEFAULT 'bronze',
        lifetime_spend NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        referral_code  VARCHAR(20) UNIQUE,
        referred_by    INTEGER,
        onboarded_at   TIMESTAMPTZ,
        onboarding_step INTEGER NOT NULL DEFAULT 1,
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
        totp_secret   VARCHAR(255),
        totp_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
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
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          SERIAL PRIMARY KEY,
        actor_id    INTEGER,
        actor_type  audit_actor_type NOT NULL DEFAULT 'system',
        action      VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id   INTEGER,
        metadata    TEXT,
        ip          VARCHAR(45),
        user_agent  VARCHAR(500),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, actor_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS otps (
        id          SERIAL PRIMARY KEY,
        phone       VARCHAR(20) NOT NULL,
        code        VARCHAR(10) NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── otps schema drift reconcile ─────────────────────────────────────
    // The OTP design migrated from plaintext (column `code`) to argon2
    // hashed (column `code_hash`) plus per-row attempt counter. Production
    // tables created by the original CREATE TABLE above don't have the
    // new columns. This reconciliation is idempotent and non-destructive:
    //
    //   1. Add code_hash + attempts columns (IF NOT EXISTS).
    //   2. Make legacy `code` nullable so new INSERTs don't violate
    //      NOT NULL on a column the runtime no longer writes.
    //
    // Existing rows with plaintext `code` are kept; they expire naturally
    // via the cleanupExpiredOtps job (which deletes by expires_at, no
    // schema dependency on which column has the value).
    await db.execute(sql`
      ALTER TABLE otps
        ADD COLUMN IF NOT EXISTS code_hash VARCHAR(255),
        ADD COLUMN IF NOT EXISTS attempts  INTEGER NOT NULL DEFAULT 0;
    `);
    await db.execute(sql`
      ALTER TABLE otps ALTER COLUMN code DROP NOT NULL;
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_otps_phone ON otps(phone);
      CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id            SERIAL PRIMARY KEY,
        identifier    VARCHAR(100) NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        locked_until  TIMESTAMPTZ,
        last_attempt  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_auth_identities (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL,
        provider       VARCHAR(50) NOT NULL,
        provider_uid   VARCHAR(255) NOT NULL,
        firebase_uid   VARCHAR(255),
        email          VARCHAR(255),
        phone          VARCHAR(20),
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        linked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wallet_ledger (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL,
        type            ledger_entry_type NOT NULL,
        amount          NUMERIC(10,2) NOT NULL,
        balance_before  NUMERIC(10,2) NOT NULL,
        balance_after   NUMERIC(10,2) NOT NULL,
        reference_id    INTEGER,
        reference_type  VARCHAR(50),
        description     VARCHAR(500),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_type ON wallet_ledger(type);
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created ON wallet_ledger(created_at DESC);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS auth_activity (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER,
        identifier      VARCHAR(255) NOT NULL,
        action          VARCHAR(50) NOT NULL,
        provider        VARCHAR(50),
        success         BOOLEAN NOT NULL,
        ip_address      VARCHAR(45),
        user_agent      TEXT,
        failure_reason  VARCHAR(255),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_auth_activity_user ON auth_activity(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_identifier ON auth_activity(identifier);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_action ON auth_activity(action);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_created ON auth_activity(created_at DESC);
    `);

    // ── Idempotent column additions (for upgrades on existing DBs) ──────────
    // Organizations table + users.organization_id (added in drizzle migration 0001)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        slug       VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT organizations_slug_unique UNIQUE (slug)
      );
    `);

    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_organization_id_organizations_id_fk'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_organization_id_organizations_id_fk
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Sessions table (server-side session tracking, referenced by JWT sessionId)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id         VARCHAR(255) PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent VARCHAR(255),
        ip_address VARCHAR(45),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);

    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS coupon_code     VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;
    `);

    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS github_id   VARCHAR(255) UNIQUE,
        ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(255) UNIQUE,
        ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(255) UNIQUE,
        ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255),
        ADD COLUMN IF NOT EXISTS email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS photo_url TEXT,
        ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) NOT NULL DEFAULT 'legacy_password',
        ADD COLUMN IF NOT EXISTS password_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS legacy_password_disabled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_auth_at TIMESTAMPTZ;
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid_unique
        ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // ── Passwordless cleanup (P1-5) ────────────────────────────────────────
    //
    // The platform is fully passwordless (Phone OTP / Google /
    // Telegram). The legacy `password_hash` column is now write-only
    // for the legacy_password admin path; new user rows should NOT
    // be forced to carry an empty-string placeholder.
    //
    // EXISTING rows are NOT altered — users with a real password_hash
    // keep it. Only the column constraints and DEFAULTS change so
    // new inserts behave correctly going forward.
    //
    // Each statement is wrapped in a tolerant DO block: re-running on
    // a database that has already been migrated is a no-op.
    await db.execute(sql`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `);
    await db.execute(sql`
      ALTER TABLE users ALTER COLUMN password_hash DROP DEFAULT;
    `);
    await db.execute(sql`
      ALTER TABLE users ALTER COLUMN auth_provider SET DEFAULT 'firebase_phone';
    `);
    await db.execute(sql`
      ALTER TABLE users ALTER COLUMN password_login_enabled SET DEFAULT FALSE;
    `);

    await db.execute(sql`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255),
        ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // OTP brute-force counter (B6)
    await db.execute(sql`
      ALTER TABLE otps
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    `);

    // ── Foreign Key constraints (idempotent — uses IF NOT EXISTS via DO block) ──
    const fkStatements = [
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT`,
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL`,
      `ALTER TABLE inventory ADD CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`,
      `ALTER TABLE wallet_topups ADD CONSTRAINT fk_topups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE support_tickets ADD CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE referral_events ADD CONSTRAINT fk_referral_referrer FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE referral_events ADD CONSTRAINT fk_referral_referee FOREIGN KEY (referee_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE users ADD CONSTRAINT fk_users_referred_by FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE user_auth_identities ADD CONSTRAINT fk_user_auth_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    ];
    for (const stmt of fkStatements) {
      await db.execute(
        sql`DO $$ BEGIN ${sql.raw(stmt)}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      );
    }

    // ── Missing indexes for common query patterns ───────────────────────────
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_sold ON inventory(is_sold) WHERE is_sold = false;
      CREATE INDEX IF NOT EXISTS idx_topups_user ON wallet_topups(user_id);
      CREATE INDEX IF NOT EXISTS idx_topups_status ON wallet_topups(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
      CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_events(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_identities_provider_uid ON user_auth_identities(provider, provider_uid);
      CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user ON user_auth_identities(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_auth_identities_firebase_uid ON user_auth_identities(firebase_uid);
    `);

    // ── Encrypt existing plaintext account_passwords ─────────────────────────
    if (process.env.ENCRYPTION_KEY) {
      await db.execute(sql`ALTER TABLE inventory ALTER COLUMN account_password TYPE VARCHAR(512)`);
      const result = await db.execute(
        sql`SELECT id, account_password FROM inventory WHERE account_password IS NOT NULL`,
      );
      const rows: Array<{ id: number; account_password: string }> = Array.isArray(result)
        ? (result as Array<{ id: number; account_password: string }>)
        : ((result.rows as Array<{ id: number; account_password: string }>) ?? []);
      let reEncrypted = 0;
      for (const row of rows) {
        if (!isEncrypted(row.account_password)) {
          await db.execute(
            sql`UPDATE inventory SET account_password = ${encrypt(row.account_password)} WHERE id = ${row.id}`,
          );
          reEncrypted++;
        }
      }
      if (reEncrypted > 0) {
        logger.info({ reEncrypted }, "Re-encrypted plaintext inventory passwords");
      }
    } else {
      logger.warn("ENCRYPTION_KEY not set — inventory passwords remain plaintext");
    }

    // ── Seed: default auth provider configs (no-op if already set) ──────────
    const providerDefaults = [
      ["auth.google", JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.github", JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.facebook", JSON.stringify({ enabled: false, app_id: "", app_secret: "" })],
      ["auth.telegram", JSON.stringify({ enabled: false, bot_username: "", bot_token: "" })],
      [
        "auth.apple",
        JSON.stringify({ enabled: false, client_id: "", team_id: "", key_id: "", private_key: "" }),
      ],
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
      const adminUsername = process.env.ADMIN_USERNAME || "admin";
      const adminPassword = process.env.ADMIN_PASSWORD || "SubNation@2026";
      await db.execute(sql`
        INSERT INTO admin_users (username, password_hash, display_name, role)
        VALUES (${adminUsername}, ${await hashPassword(adminPassword)}, 'مدير النظام', 'superadmin')
      `);
      logger.info({ username: adminUsername }, "Default admin user created");
    }

    // ── Seed: Products ──────────────────────────────────────────────────────
    const productCountResult = await db.execute(sql`SELECT COUNT(*) as c FROM products`);
    const productCount = (productCountResult as any).rows?.[0] ?? (productCountResult as any)[0];
    if (Number(productCount?.c ?? productCount?.count ?? 0) < 12) {
      const products = [
        {
          name: "Netflix Premium",
          description:
            "استمتع بأفلام ومسلسلات عالمية بجودة 4K UHD على 4 شاشات في نفس الوقت. أفضل تجربة بث في العالم.",
          image_url: null,
          price: "14.99",
          category: "streaming",
          usage_terms: "لا تغيّر كلمة المرور أو البريد الإلكتروني. استخدام الحساب بشكل شخصي فقط.",
        },
        {
          name: "Spotify Premium",
          description:
            "استمع إلى ملايين الأغاني والبودكاست بدون إعلانات وبجودة صوت عالية. مناسب للأجهزة المحمولة والحاسوب.",
          image_url: null,
          price: "5.99",
          category: "music",
          usage_terms: "عدم مشاركة الحساب مع الغير. استخدام على جهاز واحد.",
        },
        {
          name: "Disney+ Standard",
          description:
            "محتوى ديزني وماريل وبيكسار وناشيونال جيوغرافيك وحرب النجوم — كل شيء في مكان واحد.",
          image_url: null,
          price: "9.99",
          category: "streaming",
          usage_terms: "حساب شخصي. لا يسمح بتغيير بيانات الحساب.",
        },
        {
          name: "YouTube Premium",
          description:
            "شاهد يوتيوب بدون إعلانات، حمّل الفيديوهات للمشاهدة بدون إنترنت، واستمتع بـ YouTube Music مجاناً.",
          image_url: null,
          price: "6.99",
          category: "streaming",
          usage_terms: "استخدم بريدك الشخصي للدخول إلى الحساب.",
        },
        {
          name: "PlayStation Plus Essential",
          description:
            "العب أونلاين مع أصدقائك واحصل على ألعاب شهرية مجانية وخصومات حصرية على متجر PlayStation.",
          image_url: null,
          price: "17.99",
          category: "gaming",
          usage_terms: "مفتاح تفعيل رقمي — لا يُرجع بعد الاسترداد.",
        },
        {
          name: "Xbox Game Pass Ultimate",
          description:
            "مكتبة ضخمة من الألعاب لأجهزة Xbox وPC، بالإضافة إلى EA Play وخدمة اللعب السحابي.",
          image_url: null,
          price: "19.99",
          category: "gaming",
          usage_terms: "رمز تفعيل لمدة شهر. لا يُرجع بعد الاستخدام.",
        },
        {
          name: "Canva Pro",
          description:
            "أداة التصميم الاحترافية — قوالب لا محدودة، إزالة الخلفيات، تصدير بجودة عالية، وتعاون مع الفريق.",
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
          description:
            "حماية كاملة لخصوصيتك على الإنترنت. سرعة فائقة، 6000+ خادم حول العالم، بدون تسجيل بيانات.",
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
          description:
            "جميع تطبيقات Adobe — Photoshop وIllustrator وPremiere وAfter Effects وأكثر من 20 تطبيق احترافي.",
          image_url: null,
          price: "24.99",
          category: "productivity",
          usage_terms: "حساب شخصي مؤقت. لا تغيّر كلمة المرور.",
        },
        {
          name: "Crunchyroll Premium",
          description:
            "شاهد أحدث الأنمي فور بثّه في اليابان بدون إعلانات وبجودة 1080p. أكبر مكتبة أنمي في العالم.",
          image_url: null,
          price: "4.49",
          category: "streaming",
          usage_terms: "حساب مشترك. استخدم البروفايل المخصص لك.",
        },
      ];

      for (const p of products) {
        // Insert product only if name doesn't already exist
        const existRes = await db.execute(
          sql`SELECT id FROM products WHERE name = ${p.name} LIMIT 1`,
        );
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
          productId = insertedRow.id;
        }

        // Add inventory items if this product has fewer than 5 unsold units
        const invRes = await db.execute(
          sql`SELECT COUNT(*) as c FROM inventory WHERE product_id = ${productId} AND is_sold = false`,
        );
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

    // ── Add onboarding columns to users table if not present ─────────────────
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'onboarded_at'
        ) THEN
          ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'onboarding_step'
        ) THEN
          ALTER TABLE users ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 1;
        END IF;
      END $$;
    `);

    logger.info("Migrations completed");

    // ── Data Migration: Legacy providers to user_auth_identities ───────────
    try {
      const providersToMigrate = [
        { column: "google_id", provider: "google.com" },
        { column: "github_id", provider: "github.com" },
        { column: "facebook_id", provider: "facebook.com" },
        { column: "telegram_id", provider: "telegram.org" },
      ];

      for (const { column, provider } of providersToMigrate) {
        await db.execute(sql`
          INSERT INTO user_auth_identities (user_id, provider, provider_uid, firebase_uid, email, phone, email_verified, phone_verified)
          SELECT 
            id as user_id,
            ${provider} as provider,
            ${sql.raw(column)} as provider_uid,
            firebase_uid,
            email,
            phone,
            email_verified,
            phone_verified
          FROM users
          WHERE ${sql.raw(column)} IS NOT NULL
          ON CONFLICT (provider, provider_uid) DO NOTHING;
        `);
      }
      logger.info("Legacy provider data migrated to user_auth_identities");
    } catch (migErr) {
      logger.error({ err: migErr }, "Data migration failed");
    }
    // ── Stage C: full passwordless cleanup ─────────────────────────────────
    //
    // Pre-launch system with effectively zero legacy users. The previous
    // ALTERs above (DROP NOT NULL, change defaults) were a transitional
    // step; this block now drops the legacy password infrastructure
    // outright. All idempotent — safe to re-run on every cold start.
    //
    //   - password_hash               : column dropped (no production users
    //                                    rely on bcrypt-based login)
    //   - password_login_enabled      : column dropped (UI gating gone)
    //   - legacy_password_disabled_at : column dropped (audit-trail field)
    //   - github_id                   : column dropped (Stage A removed
    //                                    GitHub OAuth provider)
    //   - facebook_id                 : column dropped (Stage A removed
    //                                    Facebook OAuth provider)
    //   - otps table                  : dropped (only legacy
    //                                    /forgot-password + /reset-password
    //                                    used it; both routes removed)
    //
    // The Drizzle schema in shared/db/src/schema/users.ts has been updated
    // to match. Application code that referenced these columns has been
    // removed; the typecheck in CI catches any regression.
    await db.execute(sql`
      ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
      ALTER TABLE users DROP COLUMN IF EXISTS password_login_enabled;
      ALTER TABLE users DROP COLUMN IF EXISTS legacy_password_disabled_at;
      ALTER TABLE users DROP COLUMN IF EXISTS github_id;
      ALTER TABLE users DROP COLUMN IF EXISTS facebook_id;
    `);
    await db.execute(sql`DROP TABLE IF EXISTS otps;`);

    // ── Monetization Increment 1: profit visibility ───────────────────────
    //
    // Adds a per-product `cost_price` column for the admin pricing
    // calculator. Nullable — existing rows have no procurement cost
    // recorded; new products are expected to set it via the admin UI
    // but the backend NEVER enforces it. Pure visibility / no behavior
    // change in the order pipeline.
    //
    // Context: the audit found operators had no margin visibility
    // because product cost was never tracked. This column closes that
    // gap without altering checkout, coupon, flash-sale, or referral
    // logic. See SECURITY_FIXES.md / monetization audit notes.
    await db.execute(sql`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2);
    `);

  } catch (err) {
    logger.error({ err }, "Startup migration failed");
  }
}
