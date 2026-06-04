/**
 * Admin copilot router (T054).
 *
 * Mount point: `/api/admin/copilot/*`. Auth + scope are enforced inside
 * the leaf routes so different sub-routes can require different scopes.
 */
import { Router } from "express";
import { adminCopilotRouter as askRouter } from "./ask";
import { adminCopilotDraftRouter as draftRouter } from "./draft";
import { adminCopilotHistoryRouter as historyRouter } from "./history";
import { adminCopilotPreviewsRouter as previewsRouter } from "./previews";
import { copilotSettingsRouter } from "./settings";

export const copilotRouter = Router();
copilotRouter.use("/", askRouter);
copilotRouter.use("/", draftRouter);
copilotRouter.use("/", previewsRouter);
copilotRouter.use("/", historyRouter);
copilotRouter.use("/", copilotSettingsRouter);
