"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Search, ArrowUpDown } from "lucide-react";
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      >
        <h1 className="text-3xl font-display font-bold mb-2" style={{ color: "var(--text-primary)" }}>
          Challenge Explorer
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Browse open challenges, filter by domain/status/reward, and drill into details.
        </p>
      </motion.div>

      {/* Filters */}
      <ChallengeFilters onChange={setFilters} />

      {/* Results header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
          {rows.length} results
        </span>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <select
            className="text-sm font-medium rounded-lg px-3 py-1.5 border outline-none cursor-pointer appearance-none"
            style={{
              backgroundColor: "var(--surface-default)",
              borderColor: "var(--border-default)",
              color: "var(--text-secondary)",
            }}
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
            <div key={i} className="skeleton h-56 rounded-2xl" />
          ))}
        </div>
      ) : null}

      {/* Error */}
      {query.error ? (
        <div className="rounded-2xl border p-8 text-center"
          style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}
        >
          Failed to load challenges.
        </div>
      ) : null}

      {/* Empty state */}
      {!query.isLoading && !query.error && rows.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center"
          style={{ borderColor: "var(--border-default)" }}
        >
          <Search className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            No challenges found
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Try adjusting your filters or search terms.
          </p>
        </div>
      ) : null}

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row, idx) => (
          <ChallengeCard key={row.id} challenge={row} index={idx} />
        ))}
      </div>
    </div>
  );
}
