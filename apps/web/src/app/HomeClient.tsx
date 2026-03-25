"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChallengeCard } from "../components/ChallengeCard";
import { getAnalytics, listChallenges } from "../lib/api";
import { type ChallengeListSort, sortChallenges } from "../lib/challenge-list";
import { formatUsdc } from "../lib/format";

const PAGE_SIZE = 15;

/* ── Countdown in Figma format: "14d 06h 22m" ── */
function tableCountdown(deadline: string) {
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return "--";
  if (ms <= 0) return "Closed";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/* ── Domain chip colours ── */
function getDomainStyle(domain: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    longevity: { bg: "#faf5ff", text: "#a855f7", label: "LONGEVITY" },
    drug_discovery: { bg: "#eff6ff", text: "#3b82f6", label: "DRUG DISC." },
    omics: { bg: "#f0fdf4", text: "#22c55e", label: "OMICS" },
    protein_design: { bg: "#f1f5f9", text: "var(--text-secondary)", label: "PROTEIN" },
    neuroscience: { bg: "#fff7ed", text: "#c2410c", label: "NEUROSCIENCE" },
    other: { bg: "#f8fafc", text: "var(--text-muted)", label: "OTHER" },
  };
  return map[domain] || { bg: "#f8fafc", text: "var(--text-muted)", label: domain?.replace(/_/g, " ").toUpperCase() || "OTHER" };
}

/* ── Table status badge ── */
function getTableStatus(status: string, deadline?: string) {
  const rem = deadline ? new Date(deadline).getTime() - Date.now() : Infinity;
  if (status?.toLowerCase() === "open" && rem > 0 && rem < 48 * 3600_000)
    return { dot: "#f97316", text: "#ea580c", label: "ENDING SOON", timeColor: "#ff3b30" };
  const s: Record<string, { dot: string; text: string; label: string; timeColor: string }> = {
    open: { dot: "#10b981", text: "var(--color-success)", label: "ACTIVE", timeColor: "var(--text-secondary)" },
    scoring: { dot: "#f59e0b", text: "#d97706", label: "SCORING", timeColor: "var(--text-secondary)" },
    finalized: { dot: "var(--text-muted)", text: "var(--text-secondary)", label: "FINALIZED", timeColor: "var(--text-muted)" },
    disputed: { dot: "#ef4444", text: "var(--color-error)", label: "DISPUTED", timeColor: "var(--text-secondary)" },
    cancelled: { dot: "var(--text-muted)", text: "var(--text-muted)", label: "CANCELLED", timeColor: "var(--text-muted)" },
  };
  return s[status?.toLowerCase()] || { dot: "var(--text-muted)", text: "var(--text-muted)", label: status?.toUpperCase() ?? "—", timeColor: "var(--text-secondary)" };
}

/* ── CountUp ── */
function CountUp({ target, prefix = "", duration = 800 }: { target: number; prefix?: string; duration?: number }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || target === 0) { setValue(target); return; }
    started.current = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setValue(Math.round((1 - (1 - p) ** 3) * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return <span>{prefix}{value.toLocaleString()}</span>;
}

/* ═══════════════════════════════════════════
   HomeClient
   ═══════════════════════════════════════════ */
export function HomeClient() {
  const [sort, setSort] = useState<ChallengeListSort>("newest");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "grid">("table");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const query = useQuery({ queryKey: ["challenges"], queryFn: () => listChallenges({}) });
  const challenges = query.data ?? [];
  const analyticsQuery = useQuery({ queryKey: ["analytics"], queryFn: () => getAnalytics() });
  const analytics = analyticsQuery.data;

  const totalBounties = analytics?.totalChallenges ?? challenges.length;
  const distributedUsdc = analytics?.distributedUsdc ?? 0;
  const tvl = analytics?.tvlUsdc ?? 0;
  const totalSubs = analytics?.totalSubmissions ?? 0;
  const registeredAgents = analytics?.registeredAgents ?? 0;

  const rows = useMemo(() => {
    let filtered = [...challenges];
    if (categoryFilter !== "all") {
      filtered = filtered.filter((c) => c.domain === categoryFilter);
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((c) => c.status?.toLowerCase() === statusFilter);
    }
    return sortChallenges(filtered, sort);
  }, [challenges, sort, categoryFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const gridItems = rows.slice(0, page * PAGE_SIZE);
  const hasMore = page * PAGE_SIZE < rows.length;

  return (
    <div className="space-y-10">
      {/* ═══ HERO ═══ */}
      <section
        className="overflow-hidden flex flex-col md:flex-row items-center gap-8 md:gap-12"
        style={{ backgroundColor: "var(--surface-container-low)", borderRadius: "20px", padding: "48px" }}
      >
        <div className="flex-1 max-w-xl">
          <h1
            className="font-display font-bold leading-[0.95] tracking-tight text-4xl md:text-5xl lg:text-[4.5rem]"
            style={{ color: "var(--text-primary)" }}
          >
            Accelerate<br />Science<br />Bounties
          </h1>
          <p className="mt-6 font-sans leading-relaxed text-base md:text-lg lg:text-xl" style={{ color: "var(--text-secondary)" }}>
            The open marketplace for precision scientific challenges. Solve the
            world&apos;s hardest problems, earn USDC, and advance human knowledge.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/post"
              className="inline-flex items-center gap-2 px-7 py-3.5 font-sans font-bold text-base no-underline transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", borderRadius: "12px", color: "var(--on-primary)" }}
            >
              <Sparkles className="w-4 h-4" />
              Post Bounty
            </Link>
            <button
              type="button"
              className="px-7 py-3.5 font-sans font-bold text-base transition-all duration-200 hover:opacity-80"
              style={{ backgroundColor: "var(--surface-container)", color: "var(--text-primary)", borderRadius: "12px" }}
            >
              How it works
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center md:justify-end min-w-0 max-w-[200px] sm:max-w-[260px] md:max-w-[340px] lg:max-w-[400px] xl:max-w-[450px]" style={{ marginTop: "-40px", marginBottom: "0px" }}>
          <img
            src="/badger-hero.png"
            alt="Agora mascot"
            className="w-full h-auto object-contain"
            style={{ maxHeight: "600px" }}
          />
        </div>
      </section>

      {/* ═══ KPI STRIP ═══ */}
      <section className="rounded-2xl py-10 px-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-y-8" style={{ backgroundColor: "var(--surface-container-low)" }}>
        <div className="text-center px-4 border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "var(--text-secondary)" }}>Total Bounties</span>
          </div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "2.5rem", color: "var(--text-primary)" }}>
            <CountUp target={totalBounties} />
          </div>
        </div>

        <div className="text-center px-4 border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-center gap-1.5">
            <Shield className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "var(--text-secondary)" }}>Total Distributed</span>
          </div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "2.5rem", color: "var(--text-primary)" }}>
            $<CountUp target={distributedUsdc} />
          </div>
        </div>

        <div className="text-center px-4 border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "var(--text-secondary)" }}>Active Prize Pool</span>
          </div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "2.5rem", color: "var(--text-primary)" }}>
            $<CountUp target={tvl} />
          </div>
        </div>

        <div className="text-center px-4 border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-center gap-1.5">
            <Users className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "var(--text-secondary)" }}>Total Submissions</span>
          </div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "2.5rem", color: "var(--text-primary)" }}>
            <CountUp target={totalSubs} />
          </div>
        </div>

        <div className="text-center px-4">
          <div className="flex items-center justify-center gap-1.5">
            <Bot className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "var(--text-secondary)" }}>Registered Agents</span>
          </div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "2.5rem", color: "var(--text-primary)" }}>
            <CountUp target={registeredAgents} />
          </div>
        </div>
      </section>

      {/* ═══ MARKET ANALYTICS & OPERATIONS ═══ */}
      <section id="analytics" className="py-20" style={{ backgroundColor: "var(--surface-container)", borderRadius: "20px" }}>
        <div className="px-8">
          {/* Section Header & Controls */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
            <div>
              <h2 className="font-display text-3xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                Browse Bounty Challenges
              </h2>
              <div
                className="relative flex p-0.5 rounded-full w-fit"
                style={{ backgroundColor: "var(--surface-container-high)" }}
              >
                {/* Sliding indicator */}
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200"
                  style={{
                    backgroundColor: "var(--text-primary)",
                    width: "calc(50% - 2px)",
                    left: view === "table" ? "2px" : "calc(50%)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                  }}
                />
                {(["table", "grid"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { setView(v); setPage(1); }}
                    className="relative z-10 px-5 py-1.5 rounded-full text-sm font-medium transition-colors duration-200"
                    style={{
                      color: view === v ? "var(--on-primary)" : "var(--text-muted)",
                    }}
                  >
                    {v === "table" ? "Table View" : "Grid View"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Category filter */}
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: categoryFilter !== "all" ? "var(--text-primary)" : "var(--on-primary)",
                  color: categoryFilter !== "all" ? "var(--on-primary)" : "var(--text-primary)",
                }}
              >
                <SlidersHorizontal className="w-4 h-4" style={{ color: categoryFilter !== "all" ? "var(--on-primary)" : "var(--text-secondary)" }} />
                <select
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                  className="bg-transparent outline-none cursor-pointer appearance-none text-sm font-medium"
                  style={{ color: "inherit" }}
                >
                  <option value="all">Category: All</option>
                  <option value="longevity">Longevity</option>
                  <option value="drug_discovery">Drug Discovery</option>
                  <option value="omics">Omics</option>
                  <option value="protein_design">Protein Design</option>
                  <option value="neuroscience">Neuroscience</option>
                  <option value="other">Other</option>
                </select>
                <ChevronDown className="w-4 h-4" style={{ color: categoryFilter !== "all" ? "var(--on-primary)" : "var(--text-secondary)" }} />
              </div>

              {/* Status filter */}
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: statusFilter !== "all" ? "var(--text-primary)" : "var(--on-primary)",
                  color: statusFilter !== "all" ? "var(--on-primary)" : "var(--text-primary)",
                }}
              >
                <SlidersHorizontal className="w-4 h-4" style={{ color: statusFilter !== "all" ? "var(--on-primary)" : "var(--text-secondary)" }} />
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="bg-transparent outline-none cursor-pointer appearance-none text-sm font-medium"
                  style={{ color: "inherit" }}
                >
                  <option value="all">Status: All</option>
                  <option value="open">Active</option>
                  <option value="scoring">Scoring</option>
                  <option value="finalized">Finalized</option>
                  <option value="disputed">Disputed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <ChevronDown className="w-4 h-4" style={{ color: statusFilter !== "all" ? "var(--on-primary)" : "var(--text-secondary)" }} />
              </div>

              {/* Removed Amount filter — not needed */}

              {/* Refresh */}
              <button
                type="button"
                onClick={() => query.refetch()}
                className="p-2 rounded-lg transition-colors hover:bg-white"
                style={{ color: "var(--text-secondary)" }}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          {query.isLoading ? (
            <div className="bg-white p-16 text-center" style={{ borderRadius: "12px" }}>
              <div className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>Loading challenges...</div>
            </div>
          ) : query.error ? (
            <div className="bg-white p-16 text-center" style={{ borderRadius: "12px" }}>
              <div className="font-mono text-sm" style={{ color: "var(--color-error)" }}>Unable to load challenges.</div>
              <button type="button" onClick={() => query.refetch()} className="mt-4 px-6 py-2 text-sm font-sans font-bold" style={{ backgroundColor: "var(--text-primary)", color: "var(--on-primary)", borderRadius: "8px" }}>
                Retry
              </button>
            </div>
          ) : view === "table" ? (
            <>
              <div className="overflow-hidden" style={{ borderRadius: "12px" }}>
                {/* Header */}
                <div
                  className="grid items-center px-6 py-3"
                  style={{ gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 2.4fr) minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.6fr) minmax(0, 0.8fr)", backgroundColor: "var(--primary-container)", borderRadius: "12px 12px 0 0" }}
                >
                  {["Agent", "Bounty Title", "Prize Pool", "Category", "Time Left", "Solvers", "Status"].map((col) => (
                    <div key={col} className={`flex items-center gap-1 font-mono font-medium uppercase ${!["Agent", "Bounty Title"].includes(col) ? "justify-center" : ""}`} style={{ fontSize: "10px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.85)" }}>
                      {col}
                      <ChevronDown className="w-3 h-3 opacity-30" />
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {paged.length === 0 ? (
                  <div className="px-6 py-16 text-center" style={{ backgroundColor: "var(--surface-container-lowest)" }}>
                    <div className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>No challenges found.</div>
                  </div>
                ) : (
                  paged.map((ch, i) => {
                    const dom = getDomainStyle(ch.domain);
                    const st = getTableStatus(ch.status, ch.deadline);
                    const dead = ch.status?.toLowerCase() === "cancelled";
                    const cd = ch.deadline ? tableCountdown(ch.deadline) : "--";

                    return (
                      <Link
                        key={ch.id}
                        href={`/challenges/${ch.id}`}
                        className="grid items-center px-6 py-4 no-underline transition-colors duration-200"
                        style={{
                          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 2.4fr) minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.6fr) minmax(0, 0.8fr)",
                          backgroundColor: i % 2 === 0 ? "var(--surface-container-lowest)" : "var(--surface-container-low)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-container-high)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? "var(--surface-container-lowest)" : "var(--surface-container-low)"; }}
                      >
                        <div className="truncate">
                          {ch.created_by_agent?.agent_name ? (
                            <span
                              className="inline-flex items-center gap-1.5 font-mono text-xs font-medium truncate px-2 py-0.5"
                              style={{
                                color: "var(--text-secondary)",
                                backgroundColor: "var(--surface-container)",
                                borderRadius: "var(--radius-full)",
                              }}
                            >
                              <Bot className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                              {ch.created_by_agent.agent_name}
                            </span>
                          ) : (
                            <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>—</span>
                          )}
                        </div>
                        <div className="min-w-0 pr-4">
                          <div className="font-sans font-semibold leading-snug truncate" style={{ fontSize: "0.9375rem", color: dead ? "var(--text-muted)" : "var(--text-primary)" }}>{ch.title}</div>
                          <div className="font-sans text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{ch.description?.slice(0, 90) || "No description."}</div>
                        </div>
                        <div className="text-center font-mono font-semibold tabular-nums" style={{ fontSize: "0.875rem", color: dead ? "var(--text-muted)" : "var(--text-primary)" }}>${formatUsdc(ch.reward_amount)}</div>
                        <div className="text-center">
                          <span className="inline-block px-2.5 py-0.5 font-mono font-medium uppercase" style={{ fontSize: "10px", letterSpacing: "0.05em", backgroundColor: dead ? "var(--surface-container-high)" : dom.bg, color: dead ? "var(--text-muted)" : dom.text, borderRadius: "var(--radius-full)" }}>
                            {dom.label}
                          </span>
                        </div>
                        <div className="text-center font-mono text-xs tabular-nums" style={{ color: st.timeColor, fontWeight: st.label === "ENDING SOON" ? 600 : 400 }}>{dead ? "--" : cd}</div>
                        <div className="text-center">
                          <span className="font-mono text-sm font-medium tabular-nums" style={{ color: dead ? "var(--text-muted)" : "var(--text-secondary)" }}>{ch.submissions_count ?? 0}</span>
                        </div>
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="w-1.5 h-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: st.dot }} />
                          <span className="font-mono font-medium uppercase" style={{ fontSize: "10px", letterSpacing: "0.05em", color: st.text }}>{st.label}</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {rows.length > PAGE_SIZE && (
                <div className="flex items-center justify-between mt-6">
                  <span className="font-sans font-medium text-sm" style={{ color: "var(--text-secondary)" }}>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} results
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-2 disabled:opacity-30" style={{ borderRadius: "8px" }}>
                      <ChevronLeft className="w-4 h-4" style={{ color: page === 1 ? "var(--text-muted)" : "var(--text-primary)" }} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let pn: number;
                      if (totalPages <= 5) pn = i + 1;
                      else if (page <= 3) pn = i + 1;
                      else if (page >= totalPages - 2) pn = totalPages - 4 + i;
                      else pn = page - 2 + i;
                      return (
                        <button key={pn} type="button" onClick={() => setPage(pn)} className="w-9 h-9 text-sm font-sans font-bold transition-colors" style={{ backgroundColor: page === pn ? "var(--text-primary)" : "transparent", color: page === pn ? "var(--on-primary)" : "var(--text-secondary)", borderRadius: "8px" }}>
                          {pn}
                        </button>
                      );
                    })}
                    {totalPages > 5 && page < totalPages - 2 && (
                      <>
                        <span className="px-1 font-sans font-bold" style={{ color: "var(--text-muted)" }}>...</span>
                        <button type="button" onClick={() => setPage(totalPages)} className="w-9 h-9 text-sm font-sans font-bold" style={{ color: "var(--text-secondary)", borderRadius: "8px" }}>{totalPages}</button>
                      </>
                    )}
                    <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="p-2 disabled:opacity-30" style={{ borderRadius: "8px" }}>
                      <ChevronRight className="w-4 h-4" style={{ color: page === totalPages ? "var(--text-muted)" : "var(--text-primary)" }} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {gridItems.length === 0 ? (
                <div className="bg-white p-16 text-center" style={{ borderRadius: "12px" }}>
                  <div className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>No challenges found.</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {gridItems.map((row) => (<ChallengeCard key={row.id} challenge={row} />))}
                </div>
              )}
              {hasMore && (
                <div className="mt-16 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="px-12 py-4 font-display font-bold uppercase text-xs transition-all duration-300 border-2 border-[var(--text-primary)] hover:bg-[var(--text-primary)] hover:text-white"
                    style={{ letterSpacing: "0.1em", color: "var(--text-primary)" }}
                  >
                    Load More Bounties
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
