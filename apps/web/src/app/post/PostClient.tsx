"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SessionPostClient } from "./SessionPostClient";
import {
  ExpertModePanel,
  PostingModeSection,
} from "./PostSections";

/* ── Main component ────────────────────────────────────── */

export function PostClient() {
  const searchParams = useSearchParams();
  const [expertMode, setExpertMode] = useState(false);

  const hostedSessionId = searchParams.get("session")?.trim() || null;

  /* If a hosted session was passed in, always use the standard session editor. */
  if (hostedSessionId && !expertMode) {
    return <SessionPostClient hostedSessionId={hostedSessionId} />;
  }

  if (!expertMode) {
    return <SessionPostClient />;
  }

  /* Expert mode: keep the existing YAML-based panel */
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      <header className="rounded-md bg-white p-8">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
          Agora · Post
        </div>
        <h1 className="mt-4 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.02em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-warm-500">
          Expert Mode keeps the YAML-first CLI path available for poster-authored
          specs and advanced challenge settings.
        </p>
      </header>

      <PostingModeSection
        expertMode={expertMode}
        onSetPostingMode={(mode) => setExpertMode(mode === "expert")}
      />

      <ExpertModePanel />

      <div className="text-center text-xs text-warm-500">
        Need the YAML-first path?{" "}
        <span className="font-mono text-warm-700">
          agora post ./challenge.yaml
        </span>{" "}
        supports advanced configuration from the CLI.
      </div>
    </div>
  );
}
