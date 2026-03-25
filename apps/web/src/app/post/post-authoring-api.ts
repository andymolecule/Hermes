"use client";

import type {
  AuthoringArtifactResponseOutput,
  AuthoringSessionArtifactOutput,
  AuthoringSessionOutput,
  AuthoringSessionResponseOutput,
  CreateAuthoringSessionRequestInput,
  PatchAuthoringSessionRequestInput,
} from "@agora/common";
export type AuthoringSessionRequestError = Error & { status?: number };

function parseApiErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as {
      error?: unknown;
    };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      "message" in parsed.error &&
      typeof (parsed.error as { message?: unknown }).message === "string"
    ) {
      const message = (parsed.error as { message: string }).message.trim();
      if (message.length > 0) {
        return message;
      }
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

export async function uploadAuthoringSessionFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/authoring/uploads", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }
  const payload = (await response.json()) as AuthoringArtifactResponseOutput;
  return payload.data as AuthoringSessionArtifactOutput;
}

export async function createAuthoringSession(
  input: CreateAuthoringSessionRequestInput,
) {
  const response = await fetch("/api/authoring/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }
  return ((await response.json()) as AuthoringSessionResponseOutput)
    .data as AuthoringSessionOutput;
}

export async function getAuthoringSession(sessionId: string) {
  const response = await fetch(`/api/authoring/sessions/${sessionId}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }
  return ((await response.json()) as AuthoringSessionResponseOutput)
    .data as AuthoringSessionOutput;
}

export async function patchAuthoringSession(input: {
  sessionId: string;
  body: PatchAuthoringSessionRequestInput;
}) {
  const response = await fetch(`/api/authoring/sessions/${input.sessionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  });
  if (!response.ok) {
    throw await toAuthoringSessionRequestError(response);
  }
  return ((await response.json()) as AuthoringSessionResponseOutput)
    .data as AuthoringSessionOutput;
}
