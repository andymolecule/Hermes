import type {
  AuthoringSessionErrorCodeOutput,
  AuthoringSessionPublicStateOutput,
} from "@agora/common";
import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonAuthoringSessionApiError<E extends Env>(
  c: Context<E>,
  input: {
    status: ContentfulStatusCode;
    code: AuthoringSessionErrorCodeOutput;
    message: string;
    nextAction: string;
    state?: AuthoringSessionPublicStateOutput;
    details?: Record<string, unknown>;
  },
) {
  return c.json(
    {
      error: {
        code: input.code,
        message: input.message,
        next_action: input.nextAction,
        ...(input.state ? { state: input.state } : {}),
        ...(input.details ? { details: input.details } : {}),
      },
    },
    input.status,
  );
}
