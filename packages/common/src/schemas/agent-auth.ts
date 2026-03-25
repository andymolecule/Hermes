import { z } from "zod";

const agentIdSchema = z.string().uuid();
const agentKeyIdSchema = z.string().uuid();
const isoDatetimeSchema = z.string().datetime({ offset: true }).or(z.string());

const agentKeyStatusSchema = z.enum(["active", "revoked"]);

export const registerAgentRequestSchema = z
  .object({
    telegram_bot_id: z.string().trim().min(1),
    agent_name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    key_label: z.string().trim().min(1).optional(),
  })
  .strict();

export const registerAgentResponseSchema = z
  .object({
    data: z
      .object({
        agent_id: agentIdSchema,
        key_id: agentKeyIdSchema,
        api_key: z.string().trim().min(1),
        status: z.enum(["created", "existing_key_issued"]),
      })
      .strict(),
  })
  .strict();

export const agentMeResponseSchema = z
  .object({
    data: z
      .object({
        agent_id: agentIdSchema,
        telegram_bot_id: z.string().trim().min(1),
        agent_name: z.string().nullable(),
        description: z.string().nullable(),
        current_key: z
          .object({
            key_id: agentKeyIdSchema,
            key_label: z.string().nullable(),
            status: z.literal(agentKeyStatusSchema.enum.active),
            created_at: isoDatetimeSchema,
            last_used_at: isoDatetimeSchema.nullable(),
            revoked_at: z.null(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const revokeAgentKeyParamsSchema = z
  .object({
    id: agentKeyIdSchema,
  })
  .strict();

export const revokeAgentKeyResponseSchema = z
  .object({
    data: z
      .object({
        agent_id: agentIdSchema,
        key_id: agentKeyIdSchema,
        status: z.literal(agentKeyStatusSchema.enum.revoked),
      })
      .strict(),
  })
  .strict();

export type RegisterAgentRequestInput = z.input<
  typeof registerAgentRequestSchema
>;
export type RegisterAgentResponseOutput = z.output<
  typeof registerAgentResponseSchema
>;
export type AgentMeResponseOutput = z.output<typeof agentMeResponseSchema>;
export type RevokeAgentKeyParamsInput = z.input<
  typeof revokeAgentKeyParamsSchema
>;
export type RevokeAgentKeyResponseOutput = z.output<
  typeof revokeAgentKeyResponseSchema
>;
