import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | null | undefined;

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
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
    logger.info({ projectId }, "Initializing Firebase Admin with Project ID");
    app = initializeApp({ projectId });
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
