"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowUpDown, Terminal } from "lucide-react";
import { ChallengeCard } from "../../components/ChallengeCard";
import {
  type ChallengeFilterState,
  ChallengeFilters,
} from "../../components/ChallengeFilters";
import { listChallenges } from "../../lib/api";

export function ExplorerClient() {
  const [filters, setFilters] = useState<ChallengeFilterState>({
    domain: "",
    status: "",
    minReward: "",
    search: "",
  });
  const [sort, setSort] = useState<"deadline" | "reward">("deadline");

  const query = useQuery({
    queryKey: ["challenges", filters.domain, filters.status, filters.minReward],
    queryFn: () =>
      listChallenges({
        domain: filters.domain || undefined,
        status: filters.status || undefined,
        minReward: filters.minReward ? Number(filters.minReward) : undefined,
      }),
  });

  const rows = useMemo(() => {
    const base = [...(query.data ?? [])].filter((row) => {
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
  }, [query.data, filters.search, sort]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-display font-bold mb-2 text-primary">
          Challenge Explorer
        </h1>
        <p className="text-sm text-tertiary">
          Browse open challenges, filter by domain/status/reward, and drill into details.
        </p>
      </div>

      {/* Filters */}
      <ChallengeFilters onChange={setFilters} />

      {/* Results header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-mono text-muted tabular-nums">
          {rows.length} results
        </span>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted" />
          <select
            className="text-sm font-medium px-3 py-1.5 border border-border-default rounded bg-surface-default text-secondary outline-none cursor-pointer appearance-none"
            value={sort}
            onChange={(e) => setSort(e.target.value as "deadline" | "reward")}
          >
            <option value="deadline">Sort: Deadline</option>
            <option value="reward">Sort: Reward</option>
          </select>
        </div>
      </div>

      {/* Loading skeleton */}
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

      {/* Error */}
      {query.error ? (
        <div className="rounded-lg border border-border-default p-8 text-center text-muted">
          Failed to load challenges.
        </div>
      ) : null}

      {/* Empty state — terminal style */}
      {!query.isLoading && !query.error && rows.length === 0 ? (
        <div className="rounded-md p-8 max-w-lg mx-auto bg-surface-inset">
          <div className="font-mono text-sm space-y-1 text-tertiary">
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider font-medium">hermes</span>
            </div>
            <p>$ hermes query --open</p>
            <p>&gt; No challenges found.</p>
            <p>&gt; Try adjusting filters.</p>
            <p className="inline-block animate-[blink_1s_step-end_infinite]">_</p>
          </div>
        </div>
      ) : null}

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row) => (
          <ChallengeCard key={row.id} challenge={row} />
        ))}
      </div>
    </div>
  );
}
