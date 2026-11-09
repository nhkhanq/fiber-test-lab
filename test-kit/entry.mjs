import { register } from "tsx/esm/api";

register();
const kit = await import("./index.ts");

export const {
  setupScenario,
  expectPaymentSucceeds,
  expectPaymentFails,
  expectChannelState,
  expectBalance,
  expectFee,
  expectInvoiceStatus,
  expectOnchainCapacity,
  subscribePayments,
} = kit;
