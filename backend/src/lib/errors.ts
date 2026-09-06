// Round-3 (8-a §1D): the ErrorCode enum moved to @workspace/error-codes
// (shared with the frontend) after the second drift incident. This module
// keeps the express-specific response helpers; codes are re-exported so
// existing `import { ErrorCode } from "../lib/errors"` sites are unchanged.
import { ErrorCode } from "@workspace/error-codes";

export { ErrorCode };

// Error response interface
export interface ErrorResponse {
  error: string;
  code?: ErrorCode;
  details?: Record<string, unknown>;
}

// Helper function to create error responses
export function createErrorResponse(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
): ErrorResponse {
  return { error: message, code, details };
}
