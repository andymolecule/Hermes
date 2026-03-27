import { z } from "zod";

const agentIdSchema = z.string().uuid();
const endpointIdSchema = z.string().uuid();
const isoDatetimeSchema = z.string().datetime({ offset: true }).or(z.string());
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const agentNotificationEndpointStatusSchema = z.enum([
  "active",
  "disabled",
]);

export const agentNotificationWebhookUpsertRequestSchema = z
  .object({
    url: z.string().url(),
    rotate_secret: z.boolean().optional(),
  })
  .strict();

const agentNotificationWebhookBaseSchema = z
  .object({
    endpoint_id: endpointIdSchema,
    url: z.string().url(),
    status: agentNotificationEndpointStatusSchema,
    created_at: isoDatetimeSchema,
    updated_at: isoDatetimeSchema,
  })
  .strict();

export const agentNotificationWebhookResponseSchema = z
  .object({
    data: agentNotificationWebhookBaseSchema
      .extend({
        last_delivery_at: isoDatetimeSchema.nullable(),
        last_error: z.string().nullable(),
      })
      .nullable(),
  })
  .strict();

export const upsertAgentNotificationWebhookResponseSchema = z
  .object({
    data: agentNotificationWebhookBaseSchema.extend({
      signing_secret: z.string().nullable(),
    }),
  })
  .strict();

export const disableAgentNotificationWebhookResponseSchema = z
  .object({
    data: z
      .object({
        endpoint_id: endpointIdSchema,
        status: z.literal(agentNotificationEndpointStatusSchema.enum.disabled),
      })
      .strict(),
  })
  .strict();

export const payoutClaimableWebhookEntrySchema = z
  .object({
    submission_id: z.string().uuid(),
    on_chain_submission_id: z.number().int().nonnegative(),
    rank: z.number().int().nonnegative(),
    amount: z.string(),
  })
  .strict();

export const payoutClaimableWebhookPayloadSchema = z
  .object({
    id: z.string().uuid(),
    type: z.literal("payout.claimable"),
    occurred_at: isoDatetimeSchema,
    agent_id: agentIdSchema,
    challenge: z
      .object({
        id: z.string().uuid(),
        title: z.string(),
        address: addressSchema,
        distribution_type: z.enum(["winner_take_all", "top_3", "proportional"]),
      })
      .strict(),
    solver: z
      .object({
        address: addressSchema,
      })
      .strict(),
    payout: z
      .object({
        asset: z.literal("USDC"),
        decimals: z.literal(6),
        claimable_amount: z.string(),
      })
      .strict(),
    entries: z.array(payoutClaimableWebhookEntrySchema),
  })
  .strict();

export type AgentNotificationWebhookUpsertRequestInput = z.input<
  typeof agentNotificationWebhookUpsertRequestSchema
>;
export type AgentNotificationWebhookResponseOutput = z.output<
  typeof agentNotificationWebhookResponseSchema
>;
export type UpsertAgentNotificationWebhookResponseOutput = z.output<
  typeof upsertAgentNotificationWebhookResponseSchema
>;
export type DisableAgentNotificationWebhookResponseOutput = z.output<
  typeof disableAgentNotificationWebhookResponseSchema
>;
export type PayoutClaimableWebhookPayloadOutput = z.output<
  typeof payoutClaimableWebhookPayloadSchema
>;
