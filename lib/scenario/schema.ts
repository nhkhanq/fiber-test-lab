import { z } from "zod";
import { MIN_CHANNEL_CAPACITY_CKB } from "../constants";
import { isRepresentableAmount } from "../fiber/amounts";

export const AssetSchema = z.enum(["CKB", "RUSD"]);

export const ErrorCategorySchema = z.enum([
  "insufficient_outbound",
  "no_route_found",
  "peer_offline",
  "invoice_expired",
  "invoice_cancelled",
]);


export const ChainSchema = z.strictObject({
  mining: z.enum(["manual", "auto"]).default("manual"),
});

export const ChannelSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  capacity: z
    .number()
    .positive()
    .refine((c) => c >= MIN_CHANNEL_CAPACITY_CKB, {
      message: `capacity must be >= ${MIN_CHANNEL_CAPACITY_CKB} CKB (the node's minimum funding amount; each side reserves ~99 CKB)`,
    }),
  asset: AssetSchema.default("CKB"),
});

export const AmountMatcherSchema = z.union([
  z.number(),
  z
    .strictObject({ min: z.number().optional(), max: z.number().optional() })
    .refine((m) => m.min !== undefined || m.max !== undefined, { message: "a range needs min and/or max" }),
]);

const hasAny = (value: object, keys: string[]) =>
  keys.some((k) => (value as Record<string, unknown>)[k] !== undefined);

export const BalanceCheckSchema = z
  .strictObject({
    node: z.string().min(1),
    peer: z.string().min(1).optional(),
    asset: AssetSchema.default("CKB"),
    local: AmountMatcherSchema.optional(),
    remote: AmountMatcherSchema.optional(),
    localDelta: AmountMatcherSchema.optional(),
    remoteDelta: AmountMatcherSchema.optional(),
    offered: AmountMatcherSchema.optional(),
    received: AmountMatcherSchema.optional(),
  })
  .refine((b) => hasAny(b, ["local", "remote", "localDelta", "remoteDelta", "offered", "received"]), {
    message: "a balance check needs local, remote, localDelta, remoteDelta, offered or received",
  });

export const ChannelStateSchema = z.enum([
  "NegotiatingFunding",
  "CollaboratingFundingTx",
  "SigningCommitment",
  "AwaitingTxSignatures",
  "AwaitingChannelReady",
  "ChannelReady",
  "ShuttingDown",
  "Closed",
  "Stale",
]);

export const ChannelCheckSchema = z.strictObject({
  node: z.string().min(1),
  peer: z.string().min(1),
  state: ChannelStateSchema,
  flags: z.string().min(1).optional(),
});

export const PeerCheckSchema = z.strictObject({
  node: z.string().min(1),
  peer: z.string().min(1),
  connected: z.boolean(),
});

export const PaymentStateSchema = z.enum(["succeeded", "failed", "inflight", "timeout"]);

export const InvoiceStatusSchema = z.enum(["Open", "Cancelled", "Expired", "Received", "Paid"]);

export const InvoiceCheckSchema = z.strictObject({
  node: z.string().min(1),
  status: InvoiceStatusSchema,
});

export const OnchainCheckSchema = z
  .strictObject({
    node: z.string().min(1),
    capacity: AmountMatcherSchema.optional(),
    capacityDelta: AmountMatcherSchema.optional(),
  })
  .refine((c) => hasAny(c, ["capacity", "capacityDelta"]), {
    message: "an on-chain check needs capacity or capacityDelta",
  });


export const StepExpectationSchema = z
  .strictObject({
    status: PaymentStateSchema.optional(),
    reason: ErrorCategorySchema.optional(),
    fee: AmountMatcherSchema.optional(),
    error: z.string().min(1).optional(),
    balances: z.array(BalanceCheckSchema).min(1).optional(),
    channels: z.array(ChannelCheckSchema).min(1).optional(),
    peers: z.array(PeerCheckSchema).min(1).optional(),
    invoices: z.array(InvoiceCheckSchema).min(1).optional(),
    onchain: z.array(OnchainCheckSchema).min(1).optional(),
  })
  .superRefine((exp, ctx) => {
    if (exp.reason !== undefined && exp.status !== "failed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: `expect.reason may only be set when expect.status === "failed"`,
      });
    }
  });

export const SeedActionSchema = z.enum([
  "send_payment",
  "new_invoice",
  "wait",
  "kill_node",
  "start_node",
  "mine",
  "advance_epochs",
  "assert",
  "await_payment",
  "settle_invoice",
  "cancel_invoice",
  "close_channel",
  "disconnect_peer",
  "connect_peer",
  "pause_node",
  "resume_node",
]);

export const PAYMENT_ACTIONS: readonly string[] = ["send_payment", "await_payment"];
export const REFUSABLE_ACTIONS: readonly string[] = ["settle_invoice", "cancel_invoice", "close_channel"];

const FIELD_ACTIONS: Record<string, readonly string[]> = {
  hold: ["new_invoice"],
  finalExpiryDeltaSec: ["new_invoice"],
  waitFor: ["send_payment"],
  timeoutSec: PAYMENT_ACTIONS,
  wrongPreimage: ["settle_invoice"],
  force: ["close_channel"],
};

const usesDeltas = (exp: z.infer<typeof StepExpectationSchema>): boolean =>
  (exp.balances ?? []).some((b) => b.localDelta !== undefined || b.remoteDelta !== undefined) ||
  (exp.onchain ?? []).some((c) => c.capacityDelta !== undefined);

export const SeedStepSchema = z
  .strictObject({
    action: SeedActionSchema,
    from: z.string().optional(),
    to: z.string().optional(),
    amount: z.number().positive().optional(),
    asset: AssetSchema.optional(),
    expiresInSec: z.number().positive().optional(),
    node: z.string().optional(),
    durationSec: z.number().positive().optional(),
    useInvoice: z.boolean().optional(), // send_payment: pay `to`'s invoice (from an earlier new_invoice) instead of keysend
    blocks: z.number().int().positive().optional(), // mine
    epochs: z.number().int().positive().optional(), // advance_epochs
    hold: z.boolean().optional(), // new_invoice: the payment waits, locked, for settle_invoice or cancel_invoice
    finalExpiryDeltaSec: z.number().int().positive().optional(), // new_invoice
    waitFor: z.enum(["final", "inflight"]).optional(), // send_payment
    timeoutSec: z.number().positive().optional(), // send_payment, await_payment
    wrongPreimage: z.boolean().optional(), // settle_invoice
    force: z.boolean().optional(), // close_channel
    expect: StepExpectationSchema.optional(),
  })
  .superRefine((step, ctx) => {
    const require = (field: keyof typeof step, cond = step[field] === undefined) => {
      if (cond) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `action "${step.action}" requires field "${String(field)}"`,
        });
      }
    };
    switch (step.action) {
      case "send_payment":
        require("from");
        require("to");
        require("amount");
        break;
      case "new_invoice":
        require("to");
        require("amount");
        break;
      case "wait":
        require("durationSec");
        break;
      case "kill_node":
      case "start_node":
      case "pause_node":
      case "resume_node":
      case "settle_invoice":
      case "cancel_invoice":
        require("node");
        break;
      case "await_payment":
        require("from");
        break;
      case "close_channel":
      case "disconnect_peer":
      case "connect_peer":
        require("from");
        require("to");
        break;
      case "advance_epochs":
        require("epochs");
        break;
      case "assert":
        require("expect");
        break;
      case "mine":
        break;
    }

    if (step.amount !== undefined && !isRepresentableAmount(step.amount, step.asset ?? "CKB")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: `${step.amount} is not a valid ${step.asset ?? "CKB"} amount (CKB: at most 8 decimals; UDT: whole base units)`,
      });
    }

    for (const [field, actions] of Object.entries(FIELD_ACTIONS)) {
      if (step[field as keyof typeof step] !== undefined && !actions.includes(step.action)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `"${field}" only applies to ${actions.join(" and ")} (this step is "${step.action}")`,
        });
      }
    }

    if (step.expect !== undefined && !PAYMENT_ACTIONS.includes(step.action)) {
      for (const field of ["status", "reason", "fee"] as const) {
        if (step.expect[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["expect", field],
            message: `expect.${field} describes a payment, so it only applies to send_payment and await_payment (this step is "${step.action}")`,
          });
        }
      }
    }
    if (step.expect?.error !== undefined && !REFUSABLE_ACTIONS.includes(step.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect", "error"],
        message: `expect.error only applies to ${REFUSABLE_ACTIONS.join(", ")} (this step is "${step.action}")`,
      });
    }
    const leftInFlight = step.action === "send_payment" && step.waitFor === "inflight";
    if (step.expect?.status === "inflight" && !leftInFlight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect", "status"],
        message: `expect.status "inflight" needs a send_payment with waitFor: inflight; any other step waits for the payment to finish`,
      });
    }
    if (step.expect?.status === "timeout" && leftInFlight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect", "status"],
        message: `a payment left in flight on purpose cannot time out; drop waitFor: inflight or expect "inflight"`,
      });
    }
    if (step.action === "assert" && step.expect !== undefined && usesDeltas(step.expect)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect"],
        message: `an assert step does nothing, so it has no "before" to compare with — use local/remote/capacity, or put the delta on the step that moves the funds`,
      });
    }
  });

export const ExpectationSchema = z
  .strictObject({
    status: z.enum(["succeeded", "failed"]),
    reason: ErrorCategorySchema.optional(),
    routeHops: z.number().int().nonnegative().optional(),
  })
  .superRefine((exp, ctx) => {
    if (exp.reason !== undefined && exp.status !== "failed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: `expect.reason may only be set when expect.status === "failed"`,
      });
    }
  });

export const ScenarioSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().default(""),
    tags: z.array(z.string().min(1)).default([]),
    chain: ChainSchema.default({ mining: "manual" }),
    nodes: z.array(z.string().min(1)).min(1),
    channels: z.array(ChannelSchema).default([]),
    seed: z.array(SeedStepSchema).default([]),
    expect: ExpectationSchema.optional(),
  })
  .superRefine((scenario, ctx) => {
    const declared = new Set(scenario.nodes);
    const checkNode = (name: string | undefined, path: (string | number)[]) => {
      if (name !== undefined && !declared.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `node "${name}" is not declared in nodes: [${scenario.nodes.join(", ")}]`,
        });
      }
    };

    scenario.channels.forEach((ch, i) => {
      checkNode(ch.from, ["channels", i, "from"]);
      checkNode(ch.to, ["channels", i, "to"]);
      if (ch.from === ch.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channels", i, "to"],
          message: `a channel cannot connect a node to itself ("${ch.from}")`,
        });
      }
      if (!isRepresentableAmount(ch.capacity, ch.asset)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channels", i, "capacity"],
          message: `${ch.capacity} is not a valid ${ch.asset} amount (CKB: at most 8 decimals; UDT: whole base units)`,
        });
      }
    });

    scenario.seed.forEach((st, i) => {
      checkNode(st.from, ["seed", i, "from"]);
      checkNode(st.to, ["seed", i, "to"]);
      checkNode(st.node, ["seed", i, "node"]);
      const exp = st.expect;
      if (exp === undefined) return;
      (exp.balances ?? []).forEach((b, j) => {
        checkNode(b.node, ["seed", i, "expect", "balances", j, "node"]);
        checkNode(b.peer, ["seed", i, "expect", "balances", j, "peer"]);
      });
      (exp.channels ?? []).forEach((c, j) => {
        checkNode(c.node, ["seed", i, "expect", "channels", j, "node"]);
        checkNode(c.peer, ["seed", i, "expect", "channels", j, "peer"]);
      });
      (exp.invoices ?? []).forEach((c, j) => checkNode(c.node, ["seed", i, "expect", "invoices", j, "node"]));
      (exp.onchain ?? []).forEach((c, j) => checkNode(c.node, ["seed", i, "expect", "onchain", j, "node"]));
      (exp.peers ?? []).forEach((p, j) => {
        checkNode(p.node, ["seed", i, "expect", "peers", j, "node"]);
        checkNode(p.peer, ["seed", i, "expect", "peers", j, "peer"]);
      });
    });

    if (scenario.expect !== undefined && scenario.seed.some((s) => s.waitFor === "inflight")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect"],
        message: `a top-level expect describes finished payments, but this seed leaves one in flight — put expect on the steps instead`,
      });
    }

    const hasPayment = scenario.seed.some((s) => s.action === "send_payment");
    if (scenario.expect !== undefined && !hasPayment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect"],
        message: `expect describes the outcome of the scenario's payments, but its seed has no send_payment step — nothing would be checked`,
      });
    }
    // No seed at all means an environment for something else to test against; a seed that acts
    // without checking anything is a scenario that could never fail.
    if (scenario.seed.length > 0 && scenario.expect === undefined && !scenario.seed.some((s) => s.expect !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect"],
        message: `a scenario needs an expectation: set a top-level expect, or expect on at least one seed step`,
      });
    }
  });

export type Asset = z.infer<typeof AssetSchema>;
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type SeedStep = z.infer<typeof SeedStepSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;
export type StepExpectation = z.infer<typeof StepExpectationSchema>;
export type AmountMatcher = z.infer<typeof AmountMatcherSchema>;
export type BalanceCheck = z.infer<typeof BalanceCheckSchema>;
export type ChannelCheck = z.infer<typeof ChannelCheckSchema>;
export type InvoiceCheck = z.infer<typeof InvoiceCheckSchema>;
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;
export type PeerCheck = z.infer<typeof PeerCheckSchema>;
export type PaymentState = z.infer<typeof PaymentStateSchema>;
export type OnchainCheck = z.infer<typeof OnchainCheckSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
/** A scenario as written by hand, before zod fills in its defaults. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;
