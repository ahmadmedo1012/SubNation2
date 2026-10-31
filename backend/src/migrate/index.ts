// R144-B2: the migrate/ module family barrel — the public surface of the
// R144-B2: family modules only. The historical module ../migrate.ts remains
// R144-B2: the orchestrator (runMigrations, verbatim) and the consumer façade
// R144-B2: (the 35-symbol contract) — import from "../migrate" as before.
export { getConstraintSkipAlerts } from "./alerts";
export {
  __setMigrationsFingerprintForTests,
  persistMigrationFingerprintAfterRun,
  readStoredMigrationFingerprint,
  writeStoredMigrationFingerprint,
} from "./fingerprint";
export { ensurePgTrgmExtension } from "./pg-extensions";
export {
  applyAdminSessionsStage,
  applyIdempotencyKeysStage,
  applyLedgerAmountNonzeroStage,
  applyMoneyConstraintStage,
  applyProductVariantsNullsNotDistinctStage,
  applyProductVariantsStage,
  applyProviderFulfillmentsStage,
  applySchedulerLeaseAndConsentTablesStage,
  applyTicketRepliesDriftClosureStage,
  applyUsersColumnReconcileStage,
  applyUsersPasswordlessCleanupStage,
} from "./stages/01-money-core";
export {
  applyIdempotencyDropOrderFkStage,
  applyIdempotencyReferenceTypeStage,
  applyIndexConsolidationStage,
  applyListReadPathIndexesStage,
  applyMoneyArithmeticChecksStage,
  applyMoneyLedgerUserFkRestrictStage,
  applyOrdersRefundColumnsStage,
  applyPointsLedgerStage,
  applyTopupReviewedByStage,
} from "./stages/02-points-idempotency-indexes";
export {
  applyDomainCheckConstraintsStage,
  applyIdempotencyBodyHashStage,
  applyOrdersGroupColumnStage,
  applyOrganizationsRemovalStage,
  applyR135IndexWaveStage,
  applyReferralFksRestrictStage,
  applyRetentionPruneIndexesStage,
  applyWalletLedgerTypeIndexDropStage,
} from "./stages/03-domain-org-r135-wave";
export { applyCopilotRemovalStage } from "./stages/04-copilot-removal-r181";
export { applyPushTokensStage } from "./stages/05-push-tokens-r191";
