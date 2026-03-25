import {
  AgoraError,
  type ApiErrorResponse,
  buildApiErrorResponse,
} from "@agora/common";
import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError<E extends Env>(
  c: Context<E>,
  input: {
    status: ContentfulStatusCode;
    code: string;
    message: string;
    retriable?: boolean;
    nextAction?: string;
    extras?: Record<string, unknown>;
  },
) {
  return c.json(
    buildApiErrorResponse({
      message: input.message,
      code: input.code,
      retriable: input.retriable,
      nextAction: input.nextAction,
      details: input.extras,
    }),
    input.status,
  );
}

export function toApiErrorResponse(error: unknown): {
  status: ContentfulStatusCode;
  body: ApiErrorResponse;
} {
  if (error instanceof AgoraError) {
    return {
      status: (error.status ?? 500) as ContentfulStatusCode,
      body: buildApiErrorResponse({
        message: error.message,
        code: error.code,
        retriable: error.retriable,
        nextAction: error.nextAction,
        details: error.details,
      }),
    };
  }

  return {
    status: 500,
    body: buildApiErrorResponse({
      message: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_ERROR",
      retriable: false,
    }),
  };
}
