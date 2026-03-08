"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { CHALLENGE_STATUS } from "@agora/common";

export type ChallengeFilterState = {
  domain: string;
  status: string;
  minReward: string;
  search: string;
};

const DOMAINS = ["longevity", "drug_discovery", "omics", "protein_design", "neuroscience", "other"];
const STATUSES = Object.values(CHALLENGE_STATUS);

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-[10px] font-bold font-mono uppercase tracking-wider cursor-pointer border transition-all duration-150"
      style={{
        backgroundColor: active ? "#000" : "transparent",
        color: active ? "#fff" : "#000",
        borderColor: "#000",
      }}
    >
      {label}
    </button>
  );
}

/** Search bar — CLI-style monospace */
export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex-1">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 font-mono text-xs font-bold select-none">&gt;</span>
      <input
        type="text"
        placeholder="Search challenges..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full py-2.5 pl-8 pr-4 text-xs font-mono font-medium bg-white text-black outline-none input-focus placeholder:text-black/30 tracking-wide"
      />
    </div>
  );
}

/** Filter toggle button */
export function FilterToggle({
  isOpen,
  onToggle,
  hasActiveFilters,
}: {
  isOpen: boolean;
  onToggle: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold font-mono uppercase tracking-wider border border-black transition-all duration-150 ${isOpen ? "bg-black text-white" : "bg-white text-black hover:bg-black hover:text-white"
        }`}
    >
      {isOpen ? <X className="w-3.5 h-3.5" /> : <SlidersHorizontal className="w-3.5 h-3.5" />}
      Filters
      {hasActiveFilters && !isOpen && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#ff2e63]" />
      )}
    </button>
  );
}

/** Collapsible filter panel */
export function FilterPanel({
  isOpen,
  state,
  onUpdate,
}: {
  isOpen: boolean;
  state: ChallengeFilterState;
  onUpdate: (next: Partial<ChallengeFilterState>) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="border border-black border-t-0 bg-white p-5 space-y-5 animate-[content-in_200ms_ease-out]">
      {/* Domain */}
      <div className="flex items-start gap-4">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60 pt-2 w-16 shrink-0">
          Domain
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill label="All" active={state.domain === ""} onClick={() => onUpdate({ domain: "" })} />
          {DOMAINS.map((d) => (
            <Pill
              key={d}
              label={d.replace(/_/g, " ")}
              active={state.domain === d}
              onClick={() => onUpdate({ domain: d })}
            />
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-start gap-4">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60 pt-2 w-16 shrink-0">
          Status
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill label="All" active={state.status === ""} onClick={() => onUpdate({ status: "" })} />
          {STATUSES.map((s) => (
            <Pill
              key={s}
              label={s}
              active={state.status === s}
              onClick={() => onUpdate({ status: s })}
            />
          ))}
        </div>
      </div>

      {/* Min USDC */}
      <div className="flex items-center gap-4">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60 w-16 shrink-0">
          Min USDC
        </span>
        <input
          type="number"
          min={0}
          placeholder="0"
          value={state.minReward}
          onChange={(e) => onUpdate({ minReward: e.target.value })}
          className="w-32 px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider border border-black bg-white text-black outline-none input-focus placeholder:text-black/40"
        />
      </div>
    </div>
  );
}
