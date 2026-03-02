"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowUpDown, Search as SearchIcon } from "lucide-react";
import { ChallengeCard } from "../components/ChallengeCard";
import {
  type ChallengeFilterState,
  SearchBar,
  FilterToggle,
  FilterPanel,
} from "../components/ChallengeFilters";
import { HatchedDivider } from "../components/HatchedDivider";
import { listChallenges } from "../lib/api";
import { formatUsdc } from "../lib/format";

export function HomeClient() {
  /* ── Filter + search state ── */
  const [filters, setFilters] = useState<ChallengeFilterState>({
    domain: "",
    status: "",
    minReward: "",
    search: "",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<"deadline" | "reward">("deadline");

  const hasActiveFilters = !!(filters.domain || filters.status || filters.minReward);

  function updateFilters(next: Partial<ChallengeFilterState>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  /* ── Data ── */
  const query = useQuery({
    queryKey: ["challenges", filters.domain, filters.status, filters.minReward],
    queryFn: () =>
      listChallenges({
        domain: filters.domain || undefined,
        status: filters.status || undefined,
        minReward: filters.minReward ? Number(filters.minReward) : undefined,
      }),
  });

  const challenges = query.data ?? [];

  /* Derived stats */
  const activeChallenges = challenges.filter(
    (c) => c.status?.toLowerCase() === "active",
  );
  const totalPool = challenges.reduce(
    (s, c) => s + Number(c.reward_amount || 0),
    0,
  );
  const totalSubs = challenges.reduce(
    (s, c) => s + (c.submissions_count ?? 0),
    0,
  );

  /* Filtered + sorted rows */
  const rows = useMemo(() => {
    const base = [...challenges].filter((row) => {
      if (!filters.search) return true;
      const q = filters.search.toLowerCase();
      return (
        row.title.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q)
      );
    });

    base.sort((a, b) => {
      if (sort === "reward") {
        return Number(b.reward_amount) - Number(a.reward_amount);
      }
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
    return base;
  }, [challenges, filters.search, sort]);

  return (
    <div className="space-y-6">
      {/* ═══════ HERO + TVL ═══════ */}
      <section className="py-10 text-center">
        <h1 className="text-[3rem] sm:text-[4rem] leading-none font-display font-bold text-black tracking-[-0.04em]">
          Science Bounty
        </h1>
        <p className="text-base text-black/60 font-medium mt-3 mb-8">
          Open science challenges with deterministic scoring and on-chain USDC settlement.
        </p>

        {/* TVL big number */}
        <div className="border border-black bg-white inline-block px-12 py-6 rounded-[2px]">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-black/50 mb-2">
            Total Value Locked
          </div>
          <div className="text-[3.5rem] sm:text-[4.5rem] font-display font-bold text-black leading-none tabular-nums tracking-tight">
            {formatUsdc(totalPool)}
            <span className="text-xl sm:text-2xl font-mono font-bold text-black/40 ml-2">USDC</span>
          </div>
        </div>

        {/* Mini stats row */}
        <div className="flex items-center justify-center gap-8 mt-6">
          <div className="text-center">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">Active</div>
            <div className="text-2xl font-display font-bold text-black tabular-nums">{activeChallenges.length}</div>
          </div>
          <div className="w-px h-8 bg-black/20" />
          <div className="text-center">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">Submissions</div>
            <div className="text-2xl font-display font-bold text-black tabular-nums">{totalSubs}</div>
          </div>
          <div className="w-px h-8 bg-black/20" />
          <div className="text-center">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">Challenges</div>
            <div className="text-2xl font-display font-bold text-black tabular-nums">{challenges.length}</div>
          </div>
        </div>
      </section>


      {/* ═══════ SEARCH + FILTER ROW ═══════ */}
      <div className="flex items-stretch border border-black rounded-[2px] overflow-hidden">
        <SearchBar
          value={filters.search}
          onChange={(v) => updateFilters({ search: v })}
        />
        <FilterToggle
          isOpen={filtersOpen}
          onToggle={() => setFiltersOpen(!filtersOpen)}
          hasActiveFilters={hasActiveFilters}
        />
        <div className="flex items-center border-l border-black">
          <ArrowUpDown className="w-3.5 h-3.5 text-black/50 ml-3" />
          <select
            className="text-[10px] font-bold font-mono uppercase tracking-wider px-3 py-3 bg-white text-black outline-none cursor-pointer appearance-none border-none"
            value={sort}
            onChange={(e) => setSort(e.target.value as "deadline" | "reward")}
          >
            <option value="deadline">Deadline</option>
            <option value="reward">Reward</option>
          </select>
        </div>
      </div>

      {/* ═══════ FILTER PANEL (collapsible) ═══════ */}
      <FilterPanel
        isOpen={filtersOpen}
        state={filters}
        onUpdate={updateFilters}
      />

      {/* ═══════ LOADING / ERROR / EMPTY ═══════ */}
      {query.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="flex items-start justify-between">
                <div className="skeleton skeleton-icon" />
                <div className="skeleton skeleton-badge" />
              </div>
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-desc" />
              <div className="skeleton skeleton-desc-short" />
              <div className="skeleton skeleton-footer" />
            </div>
          ))}
        </div>
      ) : null}

      {query.error ? (
        <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
          Unable to connect to API — check that the backend is running.
        </div>
      ) : null}

      {!query.isLoading && !query.error && rows.length === 0 ? (
        <div className="border border-black p-8 max-w-lg mx-auto bg-white">
          <div className="font-mono text-sm space-y-1 text-black/70">
            <div className="flex items-center gap-2 mb-3">
              <SearchIcon className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-wider font-bold">hermes</span>
            </div>
            <p>$ hermes query --open</p>
            <p>&gt; No challenges found.</p>
            <p>&gt; Try adjusting filters or post the first bounty.</p>
            <p className="inline-block animate-[blink_1s_step-end_infinite]">_</p>
          </div>
        </div>
      ) : null}

      {/* ═══════ CHALLENGE GRID ═══════ */}
      {!query.isLoading && rows.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-bold text-black/60 tabular-nums">
              {rows.length} {rows.length === 1 ? "result" : "results"}
            </span>
          </div>
          <div className="bg-plus-pattern border border-black p-4 sm:p-8 rounded-[2px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {rows.map((row) => (
                <ChallengeCard key={row.id} challenge={row} />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
