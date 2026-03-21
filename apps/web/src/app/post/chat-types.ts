"use client";

import type {
  AuthoringQuestionOutput,
  CompilationResultOutput,
} from "@agora/common";

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  files?: { name: string; status: "uploading" | "ready" | "error" }[];
  card?: CompilationResultOutput;
  questions?: AuthoringQuestionOutput[];
  timestamp: Date;
}
