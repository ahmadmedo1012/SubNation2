import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from "firebase/auth";

let app: FirebaseApp | null | undefined;
let auth: Auth | null | undefined;
let persistenceConfigured = false;

export function isFirebaseAuthConfigured() {
  return (
    import.meta.env.VITE_FIREBASE_AUTH_ENABLED === "true" &&
    !!import.meta.env.VITE_FIREBASE_API_KEY &&
    !!import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    !!import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    !!import.meta.env.VITE_FIREBASE_APP_ID
  );
}

export function getFirebaseApp() {
  if (app !== undefined) return app;
  if (!isFirebaseAuthConfigured()) {
    app = null;
    return app;
  }

  app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      });
  return app;
}

export function getFirebaseAuth() {
  if (auth !== undefined) return auth;
  const firebaseApp = getFirebaseApp();
  auth = firebaseApp ? getAuth(firebaseApp) : null;
  if (auth && !persistenceConfigured) {
    persistenceConfigured = true;
    setPersistence(auth, browserLocalPersistence).catch(() => undefined);
  }
  return auth;
}
