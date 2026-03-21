import { randomUUID } from "node:crypto";
import {
  authoringArtifactSchema,
  authoringSessionAnswerSchema,
  authoringSourceRawContextSchema,
  challengeIntentSchema,
  partialChallengeIntentSchema,
  safePublicHttpsUrlSchema,
  submitAuthoringSourceDraftRequestSchema,
} from "@agora/common";
import { z } from "zod";

const BEACH_MAX_THREAD_ID_LENGTH = 256;
const BEACH_MAX_THREAD_TITLE_LENGTH = 200;
const BEACH_MAX_HANDLE_LENGTH = 128;
const BEACH_MAX_MESSAGES = 64;
const BEACH_MAX_MESSAGE_ID_LENGTH = 256;
const BEACH_MAX_MESSAGE_CONTENT_LENGTH = 8_000;
const BEACH_MAX_ARTIFACTS = 12;
const BEACH_MAX_FILE_NAME_LENGTH = 255;
const BEACH_MAX_MIME_TYPE_LENGTH = 128;
const BEACH_MAX_ROLE_HINT_LENGTH = 128;

const beachThreadMessageSchema = z.object({
  id: z.string().trim().min(1).max(BEACH_MAX_MESSAGE_ID_LENGTH),
  body: z.string().trim().min(1).max(BEACH_MAX_MESSAGE_CONTENT_LENGTH),
  created_at: z.string().datetime({ offset: true }).optional(),
  author_handle: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_HANDLE_LENGTH)
    .optional(),
  kind: z.enum(["post", "reply", "system"]).default("reply"),
  authored_by_poster: z.boolean().optional(),
});

const beachThreadArtifactSchema = z.object({
  url: safePublicHttpsUrlSchema,
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_FILE_NAME_LENGTH)
    .optional(),
  mime_type: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_MIME_TYPE_LENGTH)
    .optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  role_hint: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_ROLE_HINT_LENGTH)
    .optional(),
});

const beachDraftSubmitFieldsSchema = z.object({
  thread: z.object({
    id: z.string().trim().min(1).max(BEACH_MAX_THREAD_ID_LENGTH),
    url: safePublicHttpsUrlSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_THREAD_TITLE_LENGTH)
      .optional(),
    poster_agent_handle: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_HANDLE_LENGTH)
      .optional(),
  }),
  messages: z.array(beachThreadMessageSchema).min(1).max(BEACH_MAX_MESSAGES),
  artifacts: z
    .array(beachThreadArtifactSchema)
    .max(BEACH_MAX_ARTIFACTS)
    .default([]),
  raw_context: authoringSourceRawContextSchema.optional(),
  intent: challengeIntentSchema,
});

const beachSessionFieldsSchema = z.object({
  thread: z.object({
    id: z.string().trim().min(1).max(BEACH_MAX_THREAD_ID_LENGTH),
    url: safePublicHttpsUrlSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_THREAD_TITLE_LENGTH)
      .optional(),
    poster_agent_handle: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_HANDLE_LENGTH)
      .optional(),
  }),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_MESSAGE_CONTENT_LENGTH)
    .optional(),
  messages: z
    .array(beachThreadMessageSchema)
    .max(BEACH_MAX_MESSAGES)
    .default([]),
  artifacts: z
    .array(authoringArtifactSchema)
    .max(BEACH_MAX_ARTIFACTS)
    .default([]),
  raw_context: authoringSourceRawContextSchema.optional(),
  structured_fields: partialChallengeIntentSchema.optional(),
});

const beachSessionRespondFieldsSchema = z.object({
  answers: z.array(authoringSessionAnswerSchema).max(16).default([]),
  message: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_MESSAGE_CONTENT_LENGTH)
    .optional(),
  artifacts: z
    .array(authoringArtifactSchema)
    .max(BEACH_MAX_ARTIFACTS)
    .default([]),
  structured_fields: partialChallengeIntentSchema.optional(),
  cannot_answer: z.boolean().optional(),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_MESSAGE_CONTENT_LENGTH)
    .optional(),
});

export const beachDraftSubmitRequestSchema =
  beachDraftSubmitFieldsSchema.superRefine((value, ctx) => {
    const posterHandle = value.thread.poster_agent_handle?.trim().toLowerCase();
    const hasPosterMessage = value.messages.some((message) => {
      if (message.kind === "system") {
        return false;
      }
      if (message.authored_by_poster === true) {
        return true;
      }
      if (!posterHandle || !message.author_handle) {
        return false;
      }
      return message.author_handle.trim().toLowerCase() === posterHandle;
    });

    if (!hasPosterMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message:
          "Beach draft import requires at least one poster-authored message. Next step: mark the thread starter or provide poster_agent_handle and retry.",
      });
    }
  });

export type BeachDraftSubmitRequestOutput = z.output<
  typeof beachDraftSubmitFieldsSchema
>;

export const beachSessionCreateRequestSchema =
  beachSessionFieldsSchema.superRefine((value, ctx) => {
    const posterHandle = value.thread.poster_agent_handle?.trim().toLowerCase();
    const hasPosterMessage = value.messages.some((message) => {
      if (message.kind === "system") {
        return false;
      }
      if (message.authored_by_poster === true) {
        return true;
      }
      if (!posterHandle || !message.author_handle) {
        return false;
      }
      return message.author_handle.trim().toLowerCase() === posterHandle;
    });

    if (!hasPosterMessage && !value.summary?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message:
          "Beach session start requires either a poster-authored message or a summary. Next step: provide one of them and retry.",
      });
    }
  });

export const beachSessionRespondRequestSchema = beachSessionRespondFieldsSchema;

export type BeachSessionCreateRequestOutput = z.output<
  typeof beachSessionFieldsSchema
>;
export type BeachSessionRespondRequestOutput = z.output<
  typeof beachSessionRespondFieldsSchema
>;

export function buildBeachRawContext(input: {
  thread: {
    id: string;
    url: string;
    poster_agent_handle?: string;
  };
  raw_context?: Record<string, unknown>;
}) {
  return {
    ...(input.raw_context ?? {}),
    beach_thread_id: input.thread.id,
    beach_thread_url: input.thread.url,
    ...(input.thread.poster_agent_handle
      ? {
          source_agent_handle: input.thread.poster_agent_handle,
          beach_poster_agent_handle: input.thread.poster_agent_handle,
        }
      : {}),
  };
}

export function normalizeBeachDraftSubmitRequest(
  input: BeachDraftSubmitRequestOutput,
) {
  const posterHandle = input.thread.poster_agent_handle?.trim().toLowerCase();
  const normalizedRawContext = buildBeachRawContext({
    thread: input.thread,
    raw_context: input.raw_context,
  });

  return submitAuthoringSourceDraftRequestSchema.parse({
    title: input.thread.title,
    external_id: input.thread.id,
    external_url: input.thread.url,
    raw_context: normalizedRawContext,
    intent: input.intent,
    messages: input.messages.map((message) => {
      const role =
        message.kind === "system"
          ? "system"
          : message.authored_by_poster === true ||
              (posterHandle &&
                message.author_handle?.trim().toLowerCase() === posterHandle)
            ? "poster"
            : "participant";
      return {
        id: message.id,
        role,
        content: message.body,
        created_at: message.created_at,
        author_handle: message.author_handle,
      };
    }),
    artifacts: input.artifacts.map((artifact) => ({
      source_url: artifact.url,
      suggested_filename: artifact.file_name,
      suggested_role: artifact.role_hint,
      mime_type: artifact.mime_type,
      size_bytes: artifact.size_bytes,
    })),
  });
}

export function normalizeBeachMessages(input: {
  thread: {
    poster_agent_handle?: string;
  };
  messages: Array<z.output<typeof beachThreadMessageSchema>>;
  appendedMessage?: string | null;
}) {
  const posterHandle = input.thread.poster_agent_handle?.trim().toLowerCase();
  const normalized = input.messages.map((message) => {
    const role: "poster" | "participant" | "system" =
      message.kind === "system"
        ? "system"
        : message.authored_by_poster === true ||
            (posterHandle &&
              message.author_handle?.trim().toLowerCase() === posterHandle)
          ? "poster"
          : "participant";
    return {
      id: message.id,
      role,
      content: message.body,
      created_at: message.created_at,
      author_handle: message.author_handle,
    };
  });

  const appendedMessage = input.appendedMessage?.trim();
  if (appendedMessage) {
    normalized.push({
      id: `beach-msg-${randomUUID()}`,
      role: "poster",
      content: appendedMessage,
      created_at: new Date().toISOString(),
      author_handle: input.thread.poster_agent_handle,
    });
  }

  return normalized;
}
