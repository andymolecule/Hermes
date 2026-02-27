"use client";

import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

export type ChallengeFilterState = {
  domain: string;
  status: string;
  minReward: string;
  search: string;
};

const DOMAINS = ["longevity", "drug_discovery", "omics", "protein_design", "neuroscience", "other"];
const STATUSES = ["active", "scoring", "disputed", "finalized", "cancelled"];

export function ChallengeFilters({
  onChange,
}: {
  onChange: (value: ChallengeFilterState) => void;
}) {
  const [state, setState] = useState<ChallengeFilterState>({
    domain: "",
    status: "",
    minReward: "",
    search: "",
  });

  function update(next: Partial<ChallengeFilterState>) {
    const updated = { ...state, ...next };
    setState(updated);
    onChange(updated);
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          type="text"
          placeholder="Search challenges by title or description..."
          value={state.search}
          onChange={(e) => update({ search: e.target.value })}
          className="w-full rounded-xl py-3 pl-11 pr-4 text-sm font-sans transition-all border outline-none focus:ring-2 focus:ring-cobalt-200/20 focus:border-cobalt-200"
          style={{
            backgroundColor: "var(--surface-default)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex gap-1">
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded border"
            style={{ backgroundColor: "var(--surface-inset)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}
          >⌘</kbd>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded border"
            style={{ backgroundColor: "var(--surface-inset)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}
          >K</kbd>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <SlidersHorizontal className="w-4 h-4" style={{ color: "var(--text-muted)" }} />

        {/* Domain pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => update({ domain: "" })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${state.domain === ""
                ? "bg-grey-900 text-white border-grey-900 shadow-sm"
                : "border-transparent hover:bg-white/50"
              }`}
            style={state.domain !== "" ? { color: "var(--text-secondary)", borderColor: "var(--border-default)" } : {}}
          >
            All
          </button>
          {DOMAINS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update({ domain: d })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${state.domain === d
                  ? "bg-grey-900 text-white border-grey-900 shadow-sm"
                  : "border-transparent hover:bg-white/50"
                }`}
              style={state.domain !== d ? { color: "var(--text-secondary)", borderColor: "var(--border-default)" } : {}}
            >
              {d.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--border-default)" }} />

        {/* Status pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => update({ status: "" })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${state.status === ""
                ? "bg-cobalt-200 text-white border-cobalt-200 shadow-sm"
                : "border-transparent hover:bg-white/50"
              }`}
            style={state.status !== "" ? { color: "var(--text-secondary)", borderColor: "var(--border-default)" } : {}}
          >
            All status
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ status: s })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${state.status === s
                  ? "bg-cobalt-200 text-white border-cobalt-200 shadow-sm"
                  : "border-transparent hover:bg-white/50"
                }`}
              style={state.status !== s ? { color: "var(--text-secondary)", borderColor: "var(--border-default)" } : {}}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--border-default)" }} />

        {/* Min reward */}
        <input
          type="number"
          min={0}
          placeholder="Min USDC"
          value={state.minReward}
          onChange={(e) => update({ minReward: e.target.value })}
          className="w-28 px-3 py-1.5 rounded-full text-xs font-mono border outline-none focus:ring-2 focus:ring-cobalt-200/20 focus:border-cobalt-200"
          style={{
            backgroundColor: "var(--surface-default)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        />
      </div>
    </div>
  );
}
