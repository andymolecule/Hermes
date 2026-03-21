"use client";

import type { CompilationResultOutput } from "@agora/common";
import {
  FileText,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Upload,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AuthoringQuestionList } from "./AuthoringQuestionList";
import type { ChatMessage } from "./chat-types";
import type { UploadedArtifact } from "./guided-state";

/* ── Types ─────────────────────────────────────────────── */

interface ChatComposerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  uploads: UploadedArtifact[];
  onSendMessage: (text: string) => void;
  onFilesSelected: (files: FileList) => void;
  onRemoveUpload: (id: string) => void;
  disabled?: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function formatRuntime(value: string) {
  return value
    .split("_")
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}

function formatTimestamp(date: Date) {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes} SENT`;
}

/* ── Sub-components ────────────────────────────────────── */

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warm-400"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  );
}

function ShimmerBar({ width }: { width: string }) {
  return (
    <div
      className="h-3 animate-pulse rounded-full bg-warm-200"
      style={{ width }}
    />
  );
}

function CompilationCard({ card }: { card: CompilationResultOutput }) {
  return (
    <div className="mt-3 rounded-md bg-white p-4 shadow-[0_4px_12px_rgba(28,28,24,0.08)]">
      <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
        Challenge Contract
      </div>

      <div className="space-y-2 text-sm">
        {card.runtime_family ? (
          <div className="flex justify-between">
            <span className="text-warm-500">Runtime</span>
            <span className="font-mono text-xs text-warm-800">
              {formatRuntime(card.runtime_family)}
            </span>
          </div>
        ) : null}

        {card.metric ? (
          <div className="flex justify-between">
            <span className="text-warm-500">Metric</span>
            <span className="font-mono text-xs text-warm-800">
              {card.metric}
            </span>
          </div>
        ) : null}

        {card.challenge_spec?.reward ? (
          <div className="flex justify-between">
            <span className="text-warm-500">Reward</span>
            <span className="font-mono text-xs text-warm-800">
              {card.challenge_spec.reward.total}
            </span>
          </div>
        ) : null}

        {card.challenge_spec?.deadline ? (
          <div className="flex justify-between">
            <span className="text-warm-500">Deadline</span>
            <span className="font-mono text-xs text-warm-800">
              {new Date(card.challenge_spec.deadline).toLocaleDateString(
                "en-US",
                { dateStyle: "medium" },
              )}
            </span>
          </div>
        ) : null}

        {card.dry_run?.summary ? (
          <div className="mt-2 rounded-[2px] bg-warm-50 px-3 py-2">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
              Dry Run
            </div>
            <div className="mt-1 text-xs text-warm-700">
              {card.dry_run.summary}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FileRows({
  files,
}: {
  files: { name: string; status: string }[];
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {files.map((file) => {
        const isPublic =
          !file.name.toLowerCase().includes("private") &&
          !file.name.toLowerCase().includes("restricted") &&
          !file.name.toLowerCase().includes("hidden");
        return (
          <div
            key={file.name}
            className="flex items-center justify-between rounded-md bg-warm-50 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-warm-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-warm-700">
                {file.name}
              </span>
              {file.status === "uploading" ? (
                <Loader2 className="h-3 w-3 animate-spin text-warm-400" />
              ) : file.status === "error" ? (
                <X className="h-3 w-3 text-red-400" />
              ) : null}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                isPublic
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-warm-200 text-warm-800"
              }`}
            >
              {isPublic ? "PUBLIC" : "RESTRICTED"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AgoraAvatar() {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-warm-900">
      <Sparkles className="h-4 w-4 text-white" />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-warm-300">
      <User className="h-4 w-4 text-warm-500" />
    </div>
  );
}

function InitialMessageBubble({ message }: { message: ChatMessage }) {
  const lines = message.content.split("\n");
  const firstLine = lines[0] ?? "";
  const rest = lines.slice(1).join("\n").trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-start gap-3"
    >
      <AgoraAvatar />
      <div className="max-w-[85%] rounded-md bg-warm-50 px-4 py-3 text-warm-800">
        <div className="text-[14px] font-semibold leading-relaxed text-warm-900">
          {firstLine}
        </div>
        {rest ? (
          <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-warm-500">
            {rest}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  if (message.id === "system-0") {
    return <InitialMessageBubble message={message} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`flex items-start gap-3 ${isAssistant ? "justify-start" : "justify-end"}`}
    >
      {isAssistant ? <AgoraAvatar /> : null}
      <div className="flex flex-col">
        <div
          className={`max-w-[85%] rounded-md px-4 py-3 ${
            isAssistant
              ? "bg-warm-50 text-warm-800"
              : "bg-gradient-to-br from-warm-900 to-warm-800 text-white"
          }`}
        >
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
            {message.content}
          </div>

          {message.files && message.files.length > 0 ? (
            <FileRows files={message.files} />
          ) : null}

          {message.questions && message.questions.length > 0 ? (
            <div className="mt-3">
              <AuthoringQuestionList
                questions={message.questions}
                tone="warm"
              />
            </div>
          ) : null}

          {message.card ? <CompilationCard card={message.card} /> : null}
        </div>
        {!isAssistant ? (
          <div className="mt-1 self-end font-mono text-[10px] text-warm-400">
            {formatTimestamp(message.timestamp)}
          </div>
        ) : null}
      </div>
      {!isAssistant ? <UserAvatar /> : null}
    </motion.div>
  );
}

/* ── Drag overlay ──────────────────────────────────────── */

function DragOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-warm-300 bg-warm-50/80 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-2 text-warm-600">
            <Upload className="h-8 w-8" />
            <span className="font-mono text-xs font-bold uppercase tracking-widest">
              Drop files here
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ── Upload strip ──────────────────────────────────────── */

function UploadStrip({
  uploads,
  onRemove,
}: {
  uploads: UploadedArtifact[];
  onRemove: (id: string) => void;
}) {
  if (uploads.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 bg-warm-50/40 px-4 py-2">
      {uploads.map((upload) => (
        <span
          key={upload.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-warm-100 px-2.5 py-1 font-mono text-[11px] text-warm-700"
        >
          <FileText className="h-3 w-3 text-warm-400" />
          {upload.file_name}
          {upload.status === "uploading" ? (
            <Loader2 className="h-3 w-3 animate-spin text-warm-400" />
          ) : upload.status === "error" ? (
            <span className="text-[10px] text-red-500">failed</span>
          ) : (
            <span className="text-[10px] text-emerald-600">ready</span>
          )}
          <button
            type="button"
            onClick={() => onRemove(upload.id)}
            className="ml-0.5 text-warm-400 transition hover:text-warm-700 motion-reduce:transition-none"
            aria-label={`Remove ${upload.file_name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── Streaming compile state ──────────────────────────── */

function StreamingCompileState({ streamingText }: { streamingText: string }) {
  const isCompiling = streamingText.toLowerCase().includes("compil");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3"
    >
      <AgoraAvatar />
      <div className="max-w-[85%] rounded-md bg-warm-50 px-4 py-3 text-warm-800">
        {streamingText ? (
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
            {streamingText}
          </div>
        ) : (
          <StreamingDots />
        )}

        {isCompiling ? (
          <>
            <div className="mt-3 space-y-2">
              <ShimmerBar width="100%" />
              <ShimmerBar width="85%" />
              <ShimmerBar width="60%" />
            </div>
            <div className="mt-3 rounded-md bg-warm-50 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Active State
              </div>
              <div className="mt-2 space-y-1 font-mono text-[11px] text-warm-600">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-500">+</span>
                  Parsing intent fields...
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-500">+</span>
                  Mapping artifacts to runtime...
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-warm-400" />
                  Building challenge spec...
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

/* ── Main component ────────────────────────────────────── */

export function ChatComposer({
  messages,
  isStreaming,
  streamingText,
  uploads,
  onSendMessage,
  onFilesSelected,
  onRemoveUpload,
  disabled = false,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Auto-scroll to bottom on new messages */
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages and streamingText are intentional triggers for scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  /* Auto-resize textarea */
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is an intentional trigger for textarea resize
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  /* ── Handlers ──────────────────────────────────── */

  function handleSend() {
    if (!input.trim() || disabled || isStreaming) return;
    onSendMessage(input.trim());
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragActive(false);
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (!dragActive) setDragActive(true);
  }

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      if (event.dataTransfer.files.length > 0) {
        onFilesSelected(event.dataTransfer.files);
      }
    },
    [onFilesSelected],
  );

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      onFilesSelected(event.target.files);
      event.target.value = "";
    }
  }

  /* ── Render ────────────────────────────────────── */

  return (
    <div
      className="relative flex h-full flex-col rounded-lg bg-white shadow-[0_20px_40px_rgba(28,28,24,0.06)]"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <DragOverlay active={dragActive} />

      {/* Header */}
      <div className="bg-warm-50/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-warm-400" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
            Challenge Composer
          </span>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
        style={{ minHeight: 320 }}
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* Streaming indicator */}
        {isStreaming ? (
          <StreamingCompileState streamingText={streamingText} />
        ) : null}
      </div>

      {/* Upload strip */}
      <UploadStrip uploads={uploads} onRemove={onRemoveUpload} />

      {/* Input bar */}
      <div className="bg-warm-50/40 px-4 py-3">
        <div className="flex items-end gap-2">
          {/* Paperclip */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 flex-shrink-0 rounded-full bg-warm-100 p-2 text-warm-500 transition-all duration-200 hover:bg-warm-200 hover:text-warm-700 hover:scale-105 active:scale-95 motion-reduce:transition-none"
            aria-label="Attach files"
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Thinking..."
                : "Describe your challenge, ask a question, or drop files..."
            }
            disabled={disabled || isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-md bg-warm-50 px-3 py-2.5 text-[14px] text-warm-800 outline-none transition placeholder:text-warm-400 focus:bg-white focus:ring-1 focus:ring-warm-200 disabled:opacity-50 motion-reduce:transition-none"
          />

          {/* Send */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || disabled || isStreaming}
            className="mb-0.5 flex-shrink-0 rounded-md bg-warm-900 p-2.5 text-white transition-all duration-200 hover:bg-warm-800 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed motion-reduce:transition-none"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
