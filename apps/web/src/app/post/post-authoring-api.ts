"use client";

import type {
  AuthoringDraftOutput,
  CompilationResultOutput,
} from "@agora/common";
import { computeDeadlineIso } from "../../lib/post-submission-window";
import type { ManagedIntentState, UploadedArtifact } from "./guided-state";
import { buildPostingArtifactsFromGuidedState } from "./guided-state";

export type AuthoringDraftRequestError = Error & { status?: number };

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

function createAuthoringDraftRequestError(response: Response, message: string) {
  const error = new Error(message) as AuthoringDraftRequestError;
  error.name = "AuthoringDraftRequestError";
  error.status = response.status;
  return error;
}

async function toAuthoringDraftRequestError(response: Response) {
  return createAuthoringDraftRequestError(
    response,
    parseApiErrorMessage(await response.text()),
  );
}

export function getAuthoringDraftRequestStatus(error: unknown) {
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
  session: AuthoringDraftOutput | null | undefined,
) {
  return (session?.compilation ?? null) as CompilationResultOutput | null;
}

export function clearCompiledSessionData(
  current: AuthoringDraftOutput | null,
): AuthoringDraftOutput | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    state: "draft",
    compilation: null,
    questions: [],
    failure_message: null,
  };
}

export async function pinDataFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pin-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await toAuthoringDraftRequestError(response);
  }
  return (await response.json()) as { cid: string };
}

export async function submitAuthoringDraft(input: {
  draftId: string;
  posterAddress?: `0x${string}`;
  intent: Partial<ManagedIntentState>;
  uploads: UploadedArtifact[];
}) {
  const response = await fetch("/api/authoring/drafts/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft_id: input.draftId || undefined,
      poster_address: input.posterAddress,
      intent: buildPostingIntent(input.intent),
      uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
    }),
  });

  if (!response.ok) {
    throw await toAuthoringDraftRequestError(response);
  }

  const payload = (await response.json()) as {
    data: { draft: AuthoringDraftOutput };
  };
  return payload.data.draft;
}

export async function getAuthoringDraft(draftId: string) {
  const response = await fetch(`/api/authoring/drafts/${draftId}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw await toAuthoringDraftRequestError(response);
  }

  const payload = (await response.json()) as {
    data: { draft: AuthoringDraftOutput };
  };
  return payload.data.draft;
}
