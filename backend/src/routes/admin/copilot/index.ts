/**
 * Admin copilot router (T054).
 *
 * Mount point: `/api/admin/copilot/*`. Auth + scope are enforced inside
 * the leaf routes so different sub-routes can require different scopes.
 */
import { Router } from "express";
import { adminCopilotRouter as askRouter } from "./ask";
import { copilotSettingsRouter } from "./settings";

export const copilotRouter = Router();
copilotRouter.use("/", askRouter);
copilotRouter.use("/", copilotSettingsRouter);
