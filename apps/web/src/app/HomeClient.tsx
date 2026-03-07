"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  Search as SearchIcon,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChallengeCard } from "../components/ChallengeCard";
import {
  type ChallengeFilterState,
  FilterPanel,
  FilterToggle,
  SearchBar,
} from "../components/ChallengeFilters";
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

  const hasActiveFilters = !!(
    filters.domain ||
    filters.status ||
    filters.minReward
  );

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
  const openChallenges = challenges.filter(
    (c) => c.status?.toLowerCase() === CHALLENGE_STATUS.open,
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
      {/* ═══════ HERO ═══════ */}
      <section className="py-10 text-center">
        <h1 className="text-[3.5rem] sm:text-[4.5rem] leading-[0.9] font-display font-bold text-black tracking-[-0.06em]">
          Science Bounty
        </h1>
        <p className="text-sm text-black/50 font-mono font-medium mt-3 mb-6 uppercase tracking-wider">
          Deterministic scoring · On-chain USDC settlement
        </p>

        {/* Post Bounty — inverted CTA */}
        <div className="flex justify-center mb-6">
          <Link
            href="/post"
            className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-3 font-semibold text-sm uppercase font-mono tracking-wider no-underline"
          >
            <Sparkles className="w-4 h-4" />
            Post Bounty
          </Link>
        </div>

        {/* Stats ticker — modular grid */}
        <div className="grid grid-cols-4 border border-black max-w-2xl mx-auto">
          <div className="bg-white px-5 py-5 border-r border-black">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-black/40 text-left">
              TVL
            </div>
            <div className="text-2xl font-display font-bold text-black tabular-nums text-left mt-2">
              ${formatUsdc(totalPool)}
            </div>
          </div>
          <div className="bg-white px-5 py-5 border-r border-black">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-black/40 text-left">
              Open
            </div>
            <div className="text-2xl font-display font-bold text-black tabular-nums text-left mt-2">
              {openChallenges.length}
            </div>
          </div>
          <div className="bg-white px-5 py-5 border-r border-black">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-black/40 text-left">
              Total Submissions
            </div>
            <div className="text-2xl font-display font-bold text-black tabular-nums text-left mt-2">
              {totalSubs}
            </div>
          </div>
          <div className="bg-white px-5 py-5">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-black/40 text-left">
              Challenges
            </div>
            <div className="text-2xl font-display font-bold text-black tabular-nums text-left mt-2">
              {challenges.length}
            </div>
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
        <div className="flex items-center border-l border-black hover:bg-black hover:text-white transition-colors duration-150 group/sort">
          <ArrowUpDown className="w-3.5 h-3.5 text-black/50 group-hover/sort:text-white/60 ml-3" />
          <div className="relative">
            <select
              className="text-[10px] font-bold font-mono uppercase tracking-wider pl-3 pr-7 py-3 bg-transparent text-inherit outline-none cursor-pointer appearance-none border-none"
              value={sort}
              onChange={(e) => setSort(e.target.value as "deadline" | "reward")}
            >
              <option value="deadline">Deadline</option>
              <option value="reward">Reward</option>
            </select>
            <ChevronDown className="w-3 h-3 opacity-40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
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
              <span className="text-[10px] uppercase tracking-wider font-bold">
                agora
              </span>
            </div>
            <p>$ agora query --open</p>
            <p>&gt; No challenges found.</p>
            <p>&gt; Try adjusting filters or post the first bounty.</p>
            <p className="inline-block animate-[blink_1s_step-end_infinite]">
              _
            </p>
          </div>
        </div>
      ) : null}

      {/* ═══════ CHALLENGE GRID ═══════ */}
      {!query.isLoading && rows.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-bold text-black/60 tabular-nums">
              {rows.length} {rows.length === 1 ? "challenge" : "challenges"}
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
