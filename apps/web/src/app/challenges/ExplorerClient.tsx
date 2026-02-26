"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
    <div className="grid" style={{ gap: 16 }}>
      <ChallengeFilters onChange={setFilters} />
      <div className="card-row">
        <div className="muted">{rows.length} results</div>
        <select
          className="select"
          style={{ width: 180 }}
          value={sort}
          onChange={(e) => setSort(e.target.value as "deadline" | "reward")}
        >
          <option value="deadline">Sort: Deadline</option>
          <option value="reward">Sort: Reward</option>
        </select>
      </div>

      {query.isLoading ? (
        <div className="card" style={{ padding: 14 }}>
          Loading challenges...
        </div>
      ) : null}
      {query.error ? (
        <div className="card" style={{ padding: 14 }}>
          Failed to load challenges.
        </div>
      ) : null}

      {!query.isLoading && !query.error && rows.length === 0 ? (
        <div className="card" style={{ padding: 14 }}>
          No challenges match these filters.
        </div>
      ) : null}

      <div className="grid grid-3">
        {rows.map((row) => (
          <ChallengeCard key={row.id} challenge={row} />
        ))}
      </div>
    </div>
  );
}
