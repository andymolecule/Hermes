"use client";

import type { CompilationResultOutput } from "@agora/common";
import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "./chat-types";
import type { UploadedArtifact } from "./guided-state";
import {
  getAuthoringDraftRequestStatus,
  pinDataFile,
  submitAuthoringDraft,
} from "./post-authoring-api";

interface IntakeField {
  key: string;
  value: string;
  source: "user" | "inferred";
}

interface UseChatStreamOptions {
  posterAddress?: `0x${string}`;
  onCompileReady?: (compilation: CompilationResultOutput) => void;
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
 * authoring draft / compile pipeline.
 *
 * MVP: wraps the existing `submitAuthoringDraft` call and formats
 * responses as chat messages.  A future pass will stream from
 * `POST /api/authoring/drafts/stream` via SSE.
 */
export function useChatStream(options: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [compilation, setCompilation] =
    useState<CompilationResultOutput | null>(null);
  const [uploads, setUploads] = useState<UploadedArtifact[]>([]);
  const [draftId, setDraftId] = useState<string>("");

  const fieldsRef = useRef<IntakeField[]>([]);
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
    setMessages((prev) => [...prev, full]);
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

  async function attemptCompile(problemText: string) {
    setIsStreaming(true);
    setStreamingText("Compiling your challenge...");

    try {
      const intent = buildManagedIntentFromChat(problemText);
      const draft = await submitAuthoringDraft({
        draftId,
        posterAddress: options.posterAddress,
        intent,
        uploads: uploads.filter((u) => u.status === "ready"),
      });

      setDraftId(draft.id);

      if (draft.state === "ready" && draft.compilation) {
        const comp = draft.compilation as CompilationResultOutput;
        setCompilation(comp);
        options.onCompileReady?.(comp);
        appendMessage({
          role: "assistant",
          content:
            "Your challenge is ready to publish. Review the details in the panel on the right and hit Publish when you're happy.",
          card: comp,
        });
      } else if (draft.state === "needs_input") {
        const questions = draft.questions ?? [];
        appendMessage({
          role: "assistant",
          content:
            questions.length > 0
              ? "I need a few more blocking inputs before I can lock the contract."
              : "I need a bit more context before I can lock the contract.",
          questions,
        });
      } else if (draft.state === "failed") {
        appendMessage({
          role: "assistant",
          content:
            draft.failure_message ??
            "This challenge type isn't supported by the managed runtime yet. You can try rephrasing or use Expert Mode from the CLI.",
        });
      } else {
        appendMessage({
          role: "assistant",
          content:
            "I've saved your draft. Add more details or files and I'll try compiling again.",
        });
      }
    } catch (error) {
      const status = getAuthoringDraftRequestStatus(error);
      const message =
        status && status >= 500
          ? "Agora authoring is temporarily unavailable. Retry in a moment."
          : error instanceof Error
            ? error.message
            : "Something went wrong.";
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
        ...messages,
        { role: "user" as const, content: trimmed },
      ]
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .filter((content) => {
          const extracted = extractFieldsFromText(content);
          return extracted.length === 0 || content.trim().length > 80;
        })
        .join("\n\n");

      void attemptCompile(allUserText);
    },
    [messages, uploads],
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
        const { cid } = await pinDataFile(file);
        const ready: UploadedArtifact = {
          ...artifact,
          uri: `ipfs://${cid}`,
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
        content: `Got ${readyCount} file${readyCount > 1 ? "s" : ""}. I'll use ${readyCount === 1 ? "it" : "them"} when compiling your challenge.\n\nAnything else, or should I try compiling now?`,
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
    compilation,
    uploads,
    draftId,
    sendMessage,
    sendFiles,
    removeUpload,
  };
}
