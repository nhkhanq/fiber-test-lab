import { z } from "zod";
import { MIN_CHANNEL_CAPACITY_CKB } from "../constants";

export const AssetSchema = z.enum(["CKB", "RUSD"]);

export const ErrorCategorySchema = z.enum([
  "insufficient_outbound",
  "insufficient_inbound",
  "no_route_found",
  "peer_offline",
  "invoice_expired",
  "amount_out_of_range",
  "asset_mismatch",
  "channel_not_ready",
  "reserve_violation",
]);

export const ChannelSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  capacity: z
    .number()
    .positive()
    .refine((c) => c >= MIN_CHANNEL_CAPACITY_CKB, {
      message: `capacity phải >= ${MIN_CHANNEL_CAPACITY_CKB} CKB (mức funding tối thiểu của node; mỗi bên reserve ~99 CKB)`,
    }),
  asset: AssetSchema.default("CKB"),
  push: z.number().nonnegative().optional(),
});

export const SeedActionSchema = z.enum([
  "send_payment",
  "new_invoice",
  "wait",
  "kill_node",
  "start_node",
]);

export const SeedStepSchema = z
  .object({
    action: SeedActionSchema,
    from: z.string().optional(),
    to: z.string().optional(),
    amount: z.number().positive().optional(),
    asset: AssetSchema.optional(),
    expiresInSec: z.number().positive().optional(),
    node: z.string().optional(),
    durationSec: z.number().positive().optional(),
  })
  .superRefine((step, ctx) => {
    const require = (field: keyof typeof step, cond = step[field] === undefined) => {
      if (cond) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `action "${step.action}" cần field "${String(field)}"`,
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
        require("node");
        break;
    }
  });

export const ExpectationSchema = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    reason: ErrorCategorySchema.optional(),
    routeHops: z.number().int().nonnegative().optional(),
  })
  .superRefine((exp, ctx) => {
    if (exp.reason !== undefined && exp.status !== "failed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: `expect.reason chỉ được set khi expect.status === "failed"`,
      });
    }
  });

export const ScenarioSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    nodes: z.array(z.string().min(1)).min(1),
    channels: z.array(ChannelSchema).default([]),
    seed: z.array(SeedStepSchema).default([]),
    expect: ExpectationSchema,
  })
  .superRefine((scenario, ctx) => {
    const declared = new Set(scenario.nodes);
    const checkNode = (name: string | undefined, path: (string | number)[]) => {
      if (name !== undefined && !declared.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `node "${name}" chưa khai báo trong nodes: [${scenario.nodes.join(", ")}]`,
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
          message: `channel không thể mở tới chính nó ("${ch.from}")`,
        });
      }
    });

    scenario.seed.forEach((st, i) => {
      checkNode(st.from, ["seed", i, "from"]);
      checkNode(st.to, ["seed", i, "to"]);
      checkNode(st.node, ["seed", i, "node"]);
    });
  });

export type Asset = z.infer<typeof AssetSchema>;
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type SeedStep = z.infer<typeof SeedStepSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
