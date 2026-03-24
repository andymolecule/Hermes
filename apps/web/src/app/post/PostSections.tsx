"use client";

import { Shield, Sparkles, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./post-ui";

type PostingMode = "standard" | "expert";

export function PostNotice({
  tone,
  children,
}: {
  tone: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-lg px-4 py-3 text-sm",
        tone === "info" && "bg-accent-50 text-accent-700",
        tone === "success" &&
          "bg-emerald-50 text-emerald-800",
        tone === "error" && "bg-red-50 text-red-800",
        tone === "warning" && "bg-amber-50 text-amber-900",
      )}
    >
      {children}
    </div>
  );
}

export function PostingModeSection({
  expertMode,
  onSetPostingMode,
}: {
  expertMode: boolean;
  onSetPostingMode: (nextMode: PostingMode) => void;
}) {
  return (
    <section className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
            Posting mode
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-warm-600">
            Standard mode validates a structured session directly against the
            official table scorer contract. Expert Mode keeps the CLI-first path
            for poster-authored specs and advanced runtime settings.
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-[var(--surface-container-low)] p-1">
          <button
            type="button"
            onClick={() => onSetPostingMode("standard")}
            className={cx(
              "rounded-md px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition motion-reduce:transition-none",
              !expertMode
                ? "bg-warm-900 text-white"
                : "text-warm-700 hover:text-warm-900",
            )}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => onSetPostingMode("expert")}
            className={cx(
              "rounded-md px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition motion-reduce:transition-none",
              expertMode
                ? "bg-warm-900 text-white"
                : "text-warm-700 hover:text-warm-900",
            )}
          >
            Expert Mode
          </button>
        </div>
      </div>
    </section>
  );
}

export function ExpertModePanel() {
  return (
    <section className="space-y-4">
      <div className="rounded-lg bg-[var(--surface-container-lowest)] p-5 shadow-[0_20px_40px_rgba(28,28,24,0.06)]">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warm-900 text-white">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
                Expert Mode
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-warm-900">
                YAML-first posting stays CLI-first
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-warm-700">
              Use Expert Mode when the standard session compiler cannot express
              your challenge definition cleanly or when you need poster-authored
              YAML with explicit runtime settings.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg bg-[var(--surface-container-lowest)] p-5">
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-warm-700" />
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
              When to switch
            </div>
          </div>
          <div className="mt-3 space-y-3 text-sm leading-6 text-warm-700">
            <p>Custom scorer image or runtime settings.</p>
            <p>
              The standard authoring path cannot express the required execution
              contract.
            </p>
            <p>
              Poster-authored specs, artifacts, or thresholds need full control.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-[var(--surface-container-low)] p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-warm-700" />
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
              CLI Path
            </div>
          </div>
          <div className="mt-3 rounded-md bg-[var(--surface-container-lowest)] px-4 py-3 font-mono text-[12px] text-warm-800">
            agora post ./challenge.yaml --format json
          </div>
          <p className="mt-3 text-sm leading-6 text-warm-700">
            Standard mode covers the fastest path when the bounty can be
            expressed as a deterministic value-to-value comparison under the
            official table scorer template.
          </p>
        </div>
      </div>
    </section>
  );
}
