import { HealthCheckResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getFirebaseAdminApp, getFirebaseAdminAuth } from "../lib/firebase-admin";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnostic endpoint - reports Firebase Admin initialization state without
// exposing any secrets. Use this to debug 401 issues in production.
router.get("/healthz/firebase", (_req, res) => {
  const flagEnabled = process.env.FIREBASE_AUTH_ENABLED === "true";
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID || null;
  const hasServiceAccountJson = !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
  const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;

  // Check JSON parseability without leaking content
  let serviceAccountValid = false;
  let serviceAccountProjectId: string | null = null;
  let parseError: string | null = null;
  if (hasServiceAccountJson) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
      serviceAccountValid =
        typeof parsed.client_email === "string" &&
        typeof parsed.private_key === "string" &&
        parsed.private_key.includes("BEGIN PRIVATE KEY");
      serviceAccountProjectId = typeof parsed.project_id === "string" ? parsed.project_id : null;
    } catch (err) {
      parseError = err instanceof Error ? err.message : "unknown parse error";
    }
  }

  const app = getFirebaseAdminApp();
  const auth = getFirebaseAdminAuth();

  res.json({
    auth_enabled_flag: flagEnabled,
    project_id_env: projectIdEnv,
    has_service_account_json: hasServiceAccountJson,
    has_client_email: hasClientEmail,
    has_private_key: hasPrivateKey,
    service_account_parse_ok: serviceAccountValid,
    service_account_project_id: serviceAccountProjectId,
    service_account_project_matches_env:
      serviceAccountProjectId !== null && serviceAccountProjectId === projectIdEnv,
    service_account_parse_error: parseError,
    admin_app_initialized: app !== null,
    admin_auth_initialized: auth !== null,
  });
});

export default router;
