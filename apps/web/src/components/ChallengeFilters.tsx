"use client";

import { useState } from "react";

export type ChallengeFilterState = {
  domain: string;
  status: string;
  minReward: string;
  search: string;
};

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
    <div className="card grid grid-2" style={{ padding: 14 }}>
      <input
        className="input"
        placeholder="Search title/description"
        value={state.search}
        onChange={(e) => update({ search: e.target.value })}
      />
      <div className="inline-grid-3">
        <select
          className="select"
          value={state.domain}
          onChange={(e) => update({ domain: e.target.value })}
        >
          <option value="">All domains</option>
          <option value="longevity">longevity</option>
          <option value="drug_discovery">drug_discovery</option>
          <option value="omics">omics</option>
          <option value="protein_design">protein_design</option>
          <option value="neuroscience">neuroscience</option>
          <option value="other">other</option>
        </select>
        <select
          className="select"
          value={state.status}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="">All status</option>
          <option value="active">active</option>
          <option value="scoring">scoring</option>
          <option value="disputed">disputed</option>
          <option value="finalized">finalized</option>
          <option value="cancelled">cancelled</option>
        </select>
        <input
          className="input"
          type="number"
          min={0}
          placeholder="Min reward"
          value={state.minReward}
          onChange={(e) => update({ minReward: e.target.value })}
        />
      </div>
    </div>
  );
}
