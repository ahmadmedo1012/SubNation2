import { logger } from "../lib/logger";
import { TopupService } from "./topup.service";

export type PaymentProvider = "almadar" | "libyana" | "sadad" | "moamalat";

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export class PaymentProcessor {
  /**
   * Process an automated payment (Mock implementation for Phase 3)
   */
  static async processPayment(
    userId: number,
    amount: number,
    provider: PaymentProvider,
    _providerData: Record<string, unknown>,
  ): Promise<PaymentResult> {
    logger.info({ userId, amount, provider }, "Processing automated payment");

    // MOCK: Simulate API call to provider
    const isSuccessful = Math.random() > 0.05; // 95% success rate for simulation

    if (!isSuccessful) {
      return { success: false, error: "فشلت عملية الدفع من قبل المزود" };
    }

    const mockTransactionId = `TXN_${provider.toUpperCase()}_${Date.now()}`;

    try {
      await TopupService.createApprovedTopup(userId, amount, provider, mockTransactionId);
      logger.info(
        { userId, amount, mockTransactionId },
        "Automated payment successful and credited",
      );

      return { success: true, transactionId: mockTransactionId };
    } catch (err) {
      logger.error({ err, userId }, "Error finalising automated payment");
      return { success: false, error: "خطأ داخلي أثناء معالجة الدفع" };
    }
  }
}
