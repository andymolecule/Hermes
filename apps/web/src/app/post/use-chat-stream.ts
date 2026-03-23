"use client";

import type {
  AuthoringSessionArtifactOutput,
  AuthoringSessionOutput,
} from "@agora/common";
import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "./chat-types";
import type { UploadedArtifact } from "./guided-state";
import {
  createAuthoringSession,
  getAuthoringSessionRequestStatus,
  respondToAuthoringSession,
  uploadAuthoringSessionFile,
} from "./post-authoring-api";

interface IntakeField {
  key: string;
  value: string;
  source: "user" | "inferred";
}

interface UseChatStreamOptions {
  posterAddress?: `0x${string}`;
  onCompileReady?: (session: AuthoringSessionOutput) => void;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "system-0",
  role: "assistant",
  content:
    "Tell me about the challenge you want to solve.\n\nDescribe the technical constraints, the dataset involved, and what a successful outcome looks like. I'll architect the bounty parameters in real-time.",
  timestamp: new Date(),
};

/**
 * Manages the chat conversation and bridges to the existing
 * authoring session / compile pipeline.
 *
 * MVP: wraps the session create/respond calls and formats responses
 * as chat messages. A future pass may stream incremental authoring
 * updates instead of waiting for each turn response.
 */
export function useChatStream(options: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [session, setSession] = useState<AuthoringSessionOutput | null>(null);
  const [uploads, setUploads] = useState<UploadedArtifact[]>([]);
  const [sessionId, setSessionId] = useState<string>("");

  const fieldsRef = useRef<IntakeField[]>([]);
  const messagesRef = useRef<ChatMessage[]>([INITIAL_MESSAGE]);
  const sentUploadIdsRef = useRef<Set<string>>(new Set());
  const idCounter = useRef(1);

  function nextId() {
    return `msg-${idCounter.current++}`;
  }

  function appendMessage(msg: Omit<ChatMessage, "id" | "timestamp">) {
    const full: ChatMessage = {
      ...msg,
      id: nextId(),
      timestamp: new Date(),
    };
    setMessages((prev) => {
      const next = [...prev, full];
      messagesRef.current = next;
      return next;
    });
    return full;
  }

  /* ── Parse user text for intent fields ──────────────── */

  function extractFieldsFromText(text: string) {
    const fields: IntakeField[] = [];

    const rewardMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)/i);
    if (rewardMatch?.[1]) {
      fields.push({
        key: "rewardTotal",
        value: rewardMatch[1],
        source: "user",
      });
    }

    const deadlineMatch = text.match(/(\d+)\s*(?:day|days|d)\b/i);
    if (deadlineMatch?.[1]) {
      fields.push({ key: "deadline", value: deadlineMatch[1], source: "user" });
    }

    if (/winner.?take/i.test(text)) {
      fields.push({
        key: "distribution",
        value: "winner_take_all",
        source: "user",
      });
    } else if (/top.?3/i.test(text)) {
      fields.push({ key: "distribution", value: "top_3", source: "user" });
    } else if (/proportional/i.test(text)) {
      fields.push({
        key: "distribution",
        value: "proportional",
        source: "user",
      });
    }

    return fields;
  }

  function mergeFields(incoming: IntakeField[]) {
    for (const field of incoming) {
      const existing = fieldsRef.current.findIndex((f) => f.key === field.key);
      if (existing >= 0) {
        fieldsRef.current[existing] = field;
      } else {
        fieldsRef.current.push(field);
      }
    }
  }

  function getField(key: string) {
    return fieldsRef.current.find((f) => f.key === key)?.value;
  }

  /* ── Build the managed intent for the compile call ──── */

  function buildManagedIntentFromChat(problemText: string) {
    return {
      title: problemText.slice(0, 120),
      description: problemText,
      rewardTotal: getField("rewardTotal") ?? "",
      distribution: getField("distribution") as
        | "winner_take_all"
        | "top_3"
        | "proportional"
        | undefined,
      deadline: getField("deadline") ?? "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /* ── Attempt compile ────────────────────────────────── */

  function getUnsyncedUploadRefs() {
    return uploads
      .filter(
        (upload) =>
          upload.status === "ready" && !sentUploadIdsRef.current.has(upload.id),
      )
      .map((upload) => ({
        type: "artifact" as const,
        artifact_id: upload.id,
      }));
  }

  function markUploadsSent(artifactIds: string[]) {
    for (const artifactId of artifactIds) {
      sentUploadIdsRef.current.add(artifactId);
    }
  }

  async function attemptCompile(input: {
    problemText: string;
    latestMessage: string;
  }) {
    setIsStreaming(true);
    setStreamingText("Compiling your challenge...");

    try {
      const unsyncedFiles = getUnsyncedUploadRefs();
      const nextResponse = sessionId
        ? await respondToAuthoringSession({
            sessionId,
            body: {
              ...(input.latestMessage.trim()
                ? { message: input.latestMessage.trim() }
                : {}),
              ...(unsyncedFiles.length > 0 ? { files: unsyncedFiles } : {}),
            },
          })
        : await createAuthoringSession({
            message: input.latestMessage.trim(),
            summary: input.problemText,
            ...(unsyncedFiles.length > 0 ? { files: unsyncedFiles } : {}),
          });
      const nextSession = nextResponse.session;

      setSession(nextSession);
      setSessionId(nextSession.id);
      markUploadsSent(unsyncedFiles.map((file) => file.artifact_id));

      if (nextSession.state === "ready" && nextSession.compilation) {
        options.onCompileReady?.(nextSession);
        appendMessage({
          role: "assistant",
          content: nextResponse.assistant_message,
        });
      } else if (nextSession.state === "awaiting_input") {
        const questions = nextSession.questions ?? [];
        appendMessage({
          role: "assistant",
          content: nextResponse.assistant_message,
          questions,
        });
      } else if (nextSession.state === "rejected") {
        appendMessage({
          role: "assistant",
          content: nextResponse.assistant_message,
        });
      } else {
        appendMessage({
          role: "assistant",
          content: nextResponse.assistant_message,
        });
      }
    } catch (error) {
      const status = getAuthoringSessionRequestStatus(error);
      const message =
        status === 404 || status === 409
          ? "This session is no longer available. Start a new one."
          : status && status >= 500
          ? "Agora authoring is temporarily unavailable. Retry in a moment."
          : error instanceof Error
            ? error.message
            : "Something went wrong.";
      if (status === 404 || status === 409) {
        setSession(null);
        setSessionId("");
        sentUploadIdsRef.current.clear();
      }
      appendMessage({
        role: "assistant",
        content:
          status && status >= 500
            ? message
            : `Compile failed: ${message}\n\nTry adjusting your description or files.`,
      });
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }

  /* ── Public: send a text message ────────────────────── */

  // biome-ignore lint/correctness/useExhaustiveDependencies: inner functions are stable refs within the hook closure
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendMessage({ role: "user", content: trimmed });

      const newFields = extractFieldsFromText(trimmed);
      mergeFields(newFields);

      // Collect the full problem description from all user messages
      const allUserText = [
        ...messagesRef.current,
        { role: "user" as const, content: trimmed },
      ]
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .filter((content) => {
          const extracted = extractFieldsFromText(content);
          return extracted.length === 0 || content.trim().length > 80;
        })
        .join("\n\n");

      void attemptCompile({
        problemText: allUserText,
        latestMessage: trimmed,
      });
    },
    [sessionId, uploads],
  );

  /* ── Public: handle file uploads ────────────────────── */

  // biome-ignore lint/correctness/useExhaustiveDependencies: appendMessage is a stable inner function
  const sendFiles = useCallback(async (files: FileList) => {
    const incoming: UploadedArtifact[] = Array.from(files).map((file) => ({
      id: `upload-${Date.now()}-${file.name}`,
      file_name: file.name,
      mime_type: file.type || undefined,
      size_bytes: file.size,
      status: "uploading" as const,
    }));

    setUploads((prev) => [...prev, ...incoming]);

    appendMessage({
      role: "user",
      content: `Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`,
      files: incoming.map((u) => ({ name: u.file_name, status: u.status })),
    });

    const results: UploadedArtifact[] = [];

    for (const file of Array.from(files)) {
      const artifact = incoming.find((u) => u.file_name === file.name);
      if (!artifact) continue;

      try {
        const uploadedArtifact = await uploadAuthoringSessionFile(file);
        const ready: UploadedArtifact = {
          ...uploadedArtifact,
          id: uploadedArtifact.artifact_id,
          uri: uploadedArtifact.uri,
          status: "ready",
        };
        results.push(ready);
        setUploads((prev) =>
          prev.map((u) => (u.id === artifact.id ? ready : u)),
        );
      } catch {
        const failed: UploadedArtifact = {
          ...artifact,
          status: "error",
          error: "Upload failed",
        };
        results.push(failed);
        setUploads((prev) =>
          prev.map((u) => (u.id === artifact.id ? failed : u)),
        );
      }
    }

    const readyCount = results.filter((r) => r.status === "ready").length;
    if (readyCount > 0) {
      appendMessage({
        role: "assistant",
        content: `Got ${readyCount} file${readyCount > 1 ? "s" : ""}. I'll use ${readyCount === 1 ? "it" : "them"} when compiling your challenge.\n\nAdd anything else, then send another message when you're ready for the next compile.`,
      });
    }
  }, []);

  /* ── Public: remove an upload ───────────────────────── */

  const removeUpload = useCallback((uploadId: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== uploadId));
  }, []);

  return {
    messages,
    isStreaming,
    streamingText,
    session,
    compilation: session?.compilation ?? null,
    uploads,
    sessionId,
    sendMessage,
    sendFiles,
    removeUpload,
  };
}
