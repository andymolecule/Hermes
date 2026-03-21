"use client";

import type {
  AuthoringSessionAnswerOutput,
  AuthoringSessionOutput,
  AuthoringUploadResponseOutput,
  CompilationResultOutput,
} from "@agora/common";
import { computeDeadlineIso } from "../../lib/post-submission-window";
import type { ManagedIntentState, UploadedArtifact } from "./guided-state";
import { buildPostingArtifactsFromGuidedState } from "./guided-state";

export type AuthoringSessionRequestError = Error & { status?: number };

function parseApiErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    return text || "Request failed.";
  }
  return text || "Request failed.";
}

function createAuthoringSessionRequestError(
  response: Response,
  message: string,
) {
  const error = new Error(message) as AuthoringSessionRequestError;
  error.name = "AuthoringSessionRequestError";
  error.status = response.status;
  return error;
}

async function toAuthoringSessionRequestError(response: Response) {
  return createAuthoringSessionRequestError(
    response,
    parseApiErrorMessage(await response.text()),
  );
}

export function getAuthoringSessionRequestStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function buildPostingIntent(intent: Partial<ManagedIntentState>) {
  const disputeWindowInput = intent.disputeWindowHours?.trim() ?? "";
  const payload: Record<string, unknown> = {};

  if (intent.title?.trim()) {
    payload.title = intent.title.trim();
  }
  if (intent.description?.trim()) {
    payload.description = intent.description.trim();
  }
  if (intent.payoutCondition?.trim()) {
    payload.payout_condition = intent.payoutCondition.trim();
  }
  if (intent.rewardTotal?.trim()) {
    payload.reward_total = intent.rewardTotal.trim();
  }
  if (
    typeof intent.distribution === "string" &&
    intent.distribution.length > 0
  ) {
    payload.distribution = intent.distribution;
  }
  if (intent.deadline?.trim()) {
    payload.deadline = computeDeadlineIso(intent.deadline.trim());
  }
  if (disputeWindowInput.length > 0) {
    payload.dispute_window_hours = Number(disputeWindowInput);
  }
  if (intent.domain?.trim()) {
    payload.domain = intent.domain.trim();
  }
  if (intent.tags?.trim()) {
    payload.tags = intent.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }
  if (intent.solverInstructions?.trim()) {
    payload.solver_instructions = intent.solverInstructions.trim();
  }
  if (intent.timezone?.trim()) {
    payload.timezone = intent.timezone.trim();
  }

  return payload;
}

export function getCompilation(
  session: AuthoringSessionOutput | null | undefined,
) {
  return (session?.compilation ?? null) as CompilationResultOutput | null;
}

export function clearCompiledSessionData(
  current: AuthoringSessionOutput | null,
): AuthoringSessionOutput | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    state: "awaiting_input",
    blocked_by_layer: "layer2",
    compilation: null,
    questions: [],
    reasons: [],
  };
}

export async function pinAuthoringFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/authoring/uploads", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }
  const payload = (await response.json()) as {
    data: AuthoringUploadResponseOutput;
  };
  return payload.data.artifact;
}

export async function submitAuthoringSession(input: {
  sessionId?: string;
  posterAddress?: `0x${string}`;
  intent?: Partial<ManagedIntentState>;
  structuredFields?: Record<string, unknown>;
  summary?: string;
  message?: string;
  answers?: AuthoringSessionAnswerOutput[];
  cannotAnswer?: boolean;
  reason?: string;
  uploads: UploadedArtifact[];
}) {
  const requestBody = {
    poster_address: input.posterAddress,
    summary: input.summary,
    message: input.message,
    structured_fields:
      input.structuredFields ?? buildPostingIntent(input.intent ?? {}),
    answers: input.answers,
    cannot_answer: input.cannotAnswer,
    reason: input.reason,
    artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
  };
  const response = await fetch(
    input.sessionId
      ? `/api/authoring/sessions/${input.sessionId}/respond`
      : "/api/authoring/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }

  const payload = (await response.json()) as {
    data: { session: AuthoringSessionOutput };
  };
  return payload.data.session;
}

export async function getAuthoringSession(sessionId: string) {
  const response = await fetch(`/api/authoring/sessions/${sessionId}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }

  const payload = (await response.json()) as {
    data: { session: AuthoringSessionOutput };
  };
  return payload.data.session;
}
