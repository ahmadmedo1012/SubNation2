let app: any = undefined;
let auth: any = undefined;
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

export async function getFirebaseApp() {
  if (app !== undefined) return app;
  if (!isFirebaseAuthConfigured()) {
    app = null;
    return app;
  }

  try {
    const { getApp, getApps, initializeApp } = await import("firebase/app");
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
  } catch (err) {
    console.error("Firebase app initialization failed:", err);
    app = null;
  }
  return app;
}

export async function getFirebaseAuth() {
  if (auth !== undefined) return auth;
  const firebaseApp = await getFirebaseApp();
  if (!firebaseApp) {
    auth = null;
    return auth;
  }

  try {
    const { getAuth, setPersistence, browserLocalPersistence } = await import("firebase/auth");
    auth = getAuth(firebaseApp);
    if (auth && !persistenceConfigured) {
      persistenceConfigured = true;
      setPersistence(auth, browserLocalPersistence).catch(() => undefined);
    }
  } catch (err) {
    console.error("Firebase auth initialization failed:", err);
    auth = null;
  }
  return auth;
}
