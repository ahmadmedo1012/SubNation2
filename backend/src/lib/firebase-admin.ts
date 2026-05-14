import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { logger } from "./logger";

let app: App | null | undefined;

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
      return parsed;
    } catch (err) {
      logger.error({ err }, "Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON");
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function getFirebaseAdminApp(): App | null {
  if (app !== undefined) return app;

  if (process.env.FIREBASE_AUTH_ENABLED !== "true") {
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
    app = initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId ?? projectId,
    });
    return app;
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
