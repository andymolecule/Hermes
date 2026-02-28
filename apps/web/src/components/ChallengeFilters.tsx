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

function Pill({
  label,
  active,
  activeStyle,
  onClick,
}: {
  label: string;
  active: boolean;
  activeStyle: "domain" | "status";
  onClick: () => void;
}) {
  const activeBg = activeStyle === "domain" ? "var(--color-grey-900)" : "var(--color-cobalt-200)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium cursor-pointer border rounded-full transition-all duration-150"
      style={{
        backgroundColor: active ? activeBg : "transparent",
        color: active ? "#F1F1F1" : "var(--text-secondary)",
        borderColor: active ? activeBg : "var(--border-default)",
      }}
    >
      {label}
    </button>
  );
}

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
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Search challenges by title or description..."
          value={state.search}
          onChange={(e) => update({ search: e.target.value })}
          className="w-full py-2.5 pl-10 pr-4 text-sm font-sans border border-border-default rounded bg-surface-default text-primary outline-none input-focus"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex gap-1">
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-default rounded-[2px] bg-surface-inset text-muted">⌘</kbd>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-default rounded-[2px] bg-surface-inset text-muted">K</kbd>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <SlidersHorizontal className="w-4 h-4 text-muted" />

        {/* Domain pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill label="All" active={state.domain === ""} activeStyle="domain" onClick={() => update({ domain: "" })} />
          {DOMAINS.map((d) => (
            <Pill
              key={d}
              label={d.replace(/_/g, " ")}
              active={state.domain === d}
              activeStyle="domain"
              onClick={() => update({ domain: d })}
            />
          ))}
        </div>

        <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--border-default)" }} />

        {/* Status pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill label="All status" active={state.status === ""} activeStyle="status" onClick={() => update({ status: "" })} />
          {STATUSES.map((s) => (
            <Pill
              key={s}
              label={s}
              active={state.status === s}
              activeStyle="status"
              onClick={() => update({ status: s })}
            />
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
          className="w-28 px-3 py-1.5 text-xs font-mono border border-border-default rounded-full bg-surface-default text-primary outline-none input-focus"
        />
      </div>
    </div>
  );
}
