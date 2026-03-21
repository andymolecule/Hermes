"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChatPostClient } from "./ChatPostClient";
import {
  ExpertModePanel,
  PostNotice,
  PostingModeSection,
} from "./PostSections";

/* ── Main component ────────────────────────────────────── */

export function PostClient() {
  const searchParams = useSearchParams();
  const [expertMode, setExpertMode] = useState(false);

  const hostedDraftId =
    searchParams.get("session")?.trim() ||
    searchParams.get("draft")?.trim() ||
    null;

  /* If a hosted session was passed in (Beach flow), always use managed/chat mode. */
  if (hostedDraftId && !expertMode) {
    return <ChatPostClient />;
  }

  if (!expertMode) {
    return <ChatPostClient />;
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
          Expert Mode — post a fully formed challenge YAML via the CLI.
        </p>
      </header>

      <PostingModeSection
        expertMode={expertMode}
        onSetPostingMode={(mode) => setExpertMode(mode === "expert")}
      />

      <ExpertModePanel />

      <div className="text-center text-xs text-warm-500">
        Need a custom scorer?{" "}
        <span className="font-mono text-warm-700">
          agora post ./challenge.yaml
        </span>{" "}
        supports advanced configuration from the CLI.
      </div>
    </div>
  );
}
