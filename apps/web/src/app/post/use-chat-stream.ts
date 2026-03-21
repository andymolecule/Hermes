"use client";

import type {
  AuthoringQuestionOutput,
  AuthoringSessionAnswerOutput,
  CompilationResultOutput,
} from "@agora/common";
import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "./chat-types";
import type { UploadedArtifact } from "./guided-state";
import {
  getAuthoringSessionRequestStatus,
  pinAuthoringFile,
  submitAuthoringSession,
} from "./post-authoring-api";

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

/** Manages the chat conversation against the server-owned authoring session API. */
export function useChatStream(options: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [compilation, setCompilation] =
    useState<CompilationResultOutput | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<
    AuthoringQuestionOutput[]
  >([]);
  const [uploads, setUploads] = useState<UploadedArtifact[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
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

  function describeAnswer(
    question: AuthoringQuestionOutput,
    answer: AuthoringSessionAnswerOutput,
  ) {
    if (question.kind === "artifact_role_map" && Array.isArray(answer.value)) {
      return answer.value
        .map((assignment) =>
          typeof assignment === "string"
            ? assignment
            : `${assignment.role}: ${assignment.artifact_id}`,
        )
        .join(", ");
    }

    if (typeof answer.value === "string") {
      const selectedOption = question.options.find(
        (option) => option.id === answer.value,
      );
      return selectedOption?.label ?? answer.value;
    }

    if (typeof answer.value === "number" || typeof answer.value === "boolean") {
      return String(answer.value);
    }

    return Array.isArray(answer.value) ? answer.value.join(", ") : "Answered";
  }

  function summarizeAnswers(input: {
    questions: AuthoringQuestionOutput[];
    answers: AuthoringSessionAnswerOutput[];
    message?: string;
  }) {
    const questionById = new Map(
      input.questions.map((question) => [question.id, question]),
    );
    const lines = input.answers.map((answer) => {
      const question = questionById.get(answer.question_id);
      const label = question?.label ?? answer.question_id;
      return `${label}: ${question ? describeAnswer(question, answer) : "Answered"}`;
    });
    if (input.message?.trim()) {
      lines.push(`Context: ${input.message.trim()}`);
    }
    return lines.join("\n");
  }

  function applySessionResponse(
    session: Awaited<ReturnType<typeof submitAuthoringSession>>,
  ) {
    setSessionId(session.id);

    if (session.state === "publishable" && session.compilation) {
      setPendingQuestions([]);
      const comp = session.compilation as CompilationResultOutput;
      setCompilation(comp);
      options.onCompileReady?.(comp);
      appendMessage({
        role: "assistant",
        content:
          "Your challenge is ready to publish. Review the details in the panel on the right and hit Publish when you're happy.",
        card: comp,
      });
      return;
    }

    if (session.state === "awaiting_input") {
      const questions = session.questions ?? [];
      setCompilation(null);
      setPendingQuestions(questions);
      appendMessage({
        role: "assistant",
        content:
          questions.length > 0
            ? "I need a few more blocking inputs before I can lock the contract."
            : "I need a bit more context before I can lock the contract.",
        questions,
      });
      return;
    }

    setPendingQuestions([]);
    setCompilation(null);

    if (session.state === "rejected") {
      appendMessage({
        role: "assistant",
        content:
          session.reasons[0] ??
          "This challenge type isn't supported by the managed runtime yet. You can try rephrasing or use Expert Mode from the CLI.",
      });
      return;
    }

    appendMessage({
      role: "assistant",
      content:
        "I've saved your session. Add more details or files and I'll try compiling again.",
    });
  }

  async function submitSessionUpdate(input: {
    message?: string;
    answers?: AuthoringSessionAnswerOutput[];
    cannotAnswer?: boolean;
    reason?: string;
  }) {
    setIsStreaming(true);
    setStreamingText("Sending this to Agora...");

    try {
      const session = await submitAuthoringSession({
        sessionId: sessionId || undefined,
        posterAddress: options.posterAddress,
        message: input.message,
        answers: input.answers,
        cannotAnswer: input.cannotAnswer,
        reason: input.reason,
        uploads: uploads.filter((u) => u.status === "ready"),
      });
      applySessionResponse(session);
    } catch (error) {
      const status = getAuthoringSessionRequestStatus(error);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: inner functions are stable refs within the hook closure
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendMessage({ role: "user", content: trimmed });
      void submitSessionUpdate({ message: trimmed });
    },
    [options.onCompileReady, options.posterAddress, sessionId, uploads],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: inner functions are stable refs within the hook closure
  const submitAnswers = useCallback(
    (input: { answers: AuthoringSessionAnswerOutput[]; message?: string }) => {
      if (input.answers.length === 0) {
        return;
      }

      appendMessage({
        role: "user",
        content: summarizeAnswers({
          questions: pendingQuestions,
          answers: input.answers,
          message: input.message,
        }),
      });
      void submitSessionUpdate({
        message: input.message,
        answers: input.answers,
      });
    },
    [
      pendingQuestions,
      options.onCompileReady,
      options.posterAddress,
      sessionId,
      uploads,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: inner functions are stable refs within the hook closure
  const cannotAnswer = useCallback(
    (reason?: string) => {
      appendMessage({
        role: "user",
        content:
          reason?.trim() && reason.trim().length > 0
            ? `I don't have the remaining required information.\n\n${reason.trim()}`
            : "I don't have the remaining required information to continue this challenge.",
      });
      void submitSessionUpdate({
        cannotAnswer: true,
        reason,
      });
    },
    [options.onCompileReady, options.posterAddress, sessionId, uploads],
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
        const uploaded = await pinAuthoringFile(file);
        const ready: UploadedArtifact = {
          ...artifact,
          id: uploaded.id ?? artifact.id,
          uri: uploaded.uri,
          detected_columns: uploaded.detected_columns,
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
    compilation,
    pendingQuestions,
    uploads,
    sessionId,
    sendMessage,
    submitAnswers,
    cannotAnswer,
    sendFiles,
    removeUpload,
  };
}
