import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { logger } from "./logger";

let app: App | null | undefined;

interface ServiceAccountShape {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

function parseServiceAccount(): ServiceAccountShape | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();

    // Some hosting platforms (Render, Heroku, Vercel) sanitize newlines or
    // wrap the value in extra quotes. Strip a single layer of surrounding quotes.
    const unwrapped =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;

    try {
      const parsed = JSON.parse(unwrapped) as ServiceAccountShape;

      // Normalise the private_key: env-var systems often store literal "\n"
      // sequences instead of real newlines. firebase-admin requires real newlines.
      if (parsed.private_key) {
        parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
      }

      // Sanity-check the parsed shape so we fail loudly instead of silently
      // returning an unusable object.
      if (!parsed.private_key || !parsed.client_email || !parsed.project_id) {
        logger.error(
          {
            has_project_id: !!parsed.project_id,
            has_client_email: !!parsed.client_email,
            has_private_key: !!parsed.private_key,
          },
          "FIREBASE_SERVICE_ACCOUNT_JSON parsed but missing required fields",
        );
        return null;
      }
      if (!parsed.private_key.includes("BEGIN PRIVATE KEY")) {
        logger.error(
          "FIREBASE_SERVICE_ACCOUNT_JSON private_key does not contain expected PEM header. " +
            "The value may be corrupted or improperly escaped.",
        );
        return null;
      }
      return parsed;
    } catch (err) {
      logger.error(
        {
          err,
          raw_length: raw.length,
          starts_with: raw.slice(0, 16),
        },
        "Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON - check for escaping issues",
      );
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  }

  return null;
}

export function getFirebaseAdminApp(): App | null {
  if (app !== undefined) return app;

  if (process.env.FIREBASE_AUTH_ENABLED !== "true") {
    logger.warn("FIREBASE_AUTH_ENABLED is not 'true' - Firebase Admin disabled");
    app = null;
    return app;
  }

  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  const serviceAccount = parseServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccount) {
    try {
      // firebase-admin's cert() expects camelCase or snake_case; pass both safely.
      const credential = cert({
        projectId: serviceAccount.project_id ?? serviceAccount.projectId ?? projectId ?? "",
        clientEmail: serviceAccount.client_email ?? serviceAccount.clientEmail ?? "",
        privateKey: serviceAccount.private_key ?? serviceAccount.privateKey ?? "",
      });
      app = initializeApp({
        credential,
        projectId: serviceAccount.project_id ?? serviceAccount.projectId ?? projectId,
      });
      logger.info(
        {
          projectId: serviceAccount.project_id ?? serviceAccount.projectId,
          clientEmail: serviceAccount.client_email ?? serviceAccount.clientEmail,
        },
        "Firebase Admin initialized successfully with service account",
      );
      return app;
    } catch (err) {
      logger.error(
        { err },
        "Firebase Admin initialization with service account FAILED. " +
          "This usually means the private key is malformed or the credentials are invalid.",
      );
      app = null;
      return app;
    }
  }

  if (projectId) {
    // WARNING: Initializing without service account credentials means
    // verifyIdToken will fail. Only proceed if running in Google Cloud
    // environment where Application Default Credentials are available.
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCLOUD_PROJECT) {
      logger.info(
        { projectId },
        "Initializing Firebase Admin with ADC (no explicit service account)",
      );
      app = initializeApp({ projectId });
      return app;
    }
    logger.error(
      { projectId },
      "Firebase Admin: FIREBASE_PROJECT_ID is set but no service account credentials found. " +
        "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY. " +
        "Token verification will NOT work without credentials.",
    );
    app = null;
    return app;
  }

  logger.warn("Firebase Admin NOT initialized - missing both Service Account and Project ID");
  app = null;
  return app;
}

export function getFirebaseAdminAuth(): Auth | null {
  const firebaseApp = getFirebaseAdminApp();
  return firebaseApp ? getAuth(firebaseApp) : null;
}
