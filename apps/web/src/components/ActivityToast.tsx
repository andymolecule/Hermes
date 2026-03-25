"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAnalytics } from "../lib/api";
import { formatUsdc, shortAddress } from "../lib/format";

/* ── Event types ── */

type ActivityEvent = {
  id: string;
  type: "challenge_posted" | "submission" | "scored" | "finalized";
  label: string;
  title: string;
  detail: string;
  agent: string;
  timestamp: string;
};

const EVENT_LABELS: Record<ActivityEvent["type"], string> = {
  challenge_posted: "New Bounty",
  submission: "Submission",
  scored: "Scored",
  finalized: "Finalized",
};

const POLL_INTERVAL_MS = 30_000;
const TOAST_DISPLAY_MS = 5_000;

/* ── Demo events (shown when API is unavailable) ── */

const DEMO_EVENTS: ActivityEvent[] = [
  {
    id: "demo-1",
    type: "challenge_posted",
    label: "New Bounty",
    title: "KRAS Ligand Docking Challenge",
    detail: "25 USDC bounty posted",
    agent: "AUBRAI",
    timestamp: new Date().toISOString(),
  },
  {
    id: "demo-2",
    type: "submission",
    label: "Submission",
    title: "Solution Submitted",
    detail: "Submitted to KRAS Ligand Docking",
    agent: "SolverBot",
    timestamp: new Date().toISOString(),
  },
  {
    id: "demo-3",
    type: "scored",
    label: "Scored",
    title: "Submission Scored",
    detail: "Score posted for KRAS Challenge",
    agent: "SolverBot",
    timestamp: new Date().toISOString(),
  },
  {
    id: "demo-4",
    type: "finalized",
    label: "Finalized",
    title: "Longevity Clock Reproducibility",
    detail: "30 USDC settled",
    agent: "AUBRAI",
    timestamp: new Date().toISOString(),
  },
];

/* ── Component ── */

export function ActivityToast() {
  const queueRef = useRef<ActivityEvent[]>([]);
  const [current, setCurrent] = useState<ActivityEvent | null>(null);
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const demoFired = useRef(false);

  /* ── Enqueue helper ── */
  const enqueue = useCallback((events: ActivityEvent[]) => {
    queueRef.current = [...queueRef.current, ...events];
    setCurrent((prev) => {
      if (prev !== null) return prev;
      const next = queueRef.current.shift();
      return next ?? null;
    });
  }, []);

  /* ── Auto-dismiss: when current is set, dismiss after TOAST_DISPLAY_MS ── */
  useEffect(() => {
    if (!current) return;

    const timer = setTimeout(() => {
      const next = queueRef.current.shift() ?? null;
      setCurrent(next);
    }, TOAST_DISPLAY_MS);

    return () => clearTimeout(timer);
  }, [current]);

  /* ── Poll analytics for new events ── */
  const poll = useCallback(async () => {
    try {
      const data = await getAnalytics();
      const events: ActivityEvent[] = [];

      for (const c of data.recentChallenges) {
        const key = `challenge-${c.id}`;
        if (seenIds.current.has(key)) continue;
        seenIds.current.add(key);

        if (!initialized.current) continue;

        const type =
          c.status === "finalized" ? "finalized" : "challenge_posted";
        events.push({
          id: key,
          type,
          label: EVENT_LABELS[type],
          title: c.title,
          detail:
            c.status === "finalized"
              ? `${formatUsdc(c.reward_amount)} USDC settled`
              : `${formatUsdc(c.reward_amount)} USDC bounty`,
          agent: "Agent",
          timestamp: c.created_at,
        });
      }

      for (const s of data.recentSubmissions) {
        const key = `sub-${s.id}`;
        if (seenIds.current.has(key)) continue;
        seenIds.current.add(key);

        if (!initialized.current) continue;

        const type = s.scored ? "scored" : "submission";
        events.push({
          id: key,
          type,
          label: EVENT_LABELS[type],
          title: s.scored ? "Solution Scored" : "New Submission",
          detail: s.scored
            ? `${shortAddress(s.solver_address)} received score`
            : `${shortAddress(s.solver_address)} submitted`,
          agent: shortAddress(s.solver_address),
          timestamp: s.submitted_at,
        });
      }

      initialized.current = true;

      if (events.length > 0) {
        enqueue(events);
      }
    } catch {
      // API unavailable — fire demo events once so the toast is visible
      if (!demoFired.current) {
        demoFired.current = true;
        enqueue([...DEMO_EVENTS]);
      }
    }
  }, [enqueue]);

  /* ── Polling loop ── */
  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  return (
    <div className="fixed bottom-8 right-8 z-50 pointer-events-none">
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            initial={{ y: 80, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 80, opacity: 0, scale: 0.97 }}
            transition={{
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="pointer-events-auto w-[420px] rounded-3xl overflow-hidden"
            style={{
              backgroundColor: "var(--surface-container-lowest)",
              boxShadow:
                "0 20px 48px rgba(30, 27, 24, 0.08), 0 4px 16px rgba(30, 27, 24, 0.04)",
            }}
          >
            {/* Progress bar — warm neutral */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{
                duration: TOAST_DISPLAY_MS / 1000,
                ease: "linear",
              }}
              className="h-[2px] origin-left"
              style={{ backgroundColor: "var(--color-warm-300)" }}
            />

            <div className="flex items-start gap-4 px-6 py-5">
              {/* Neutral pulse dot */}
              <div className="relative mt-1 shrink-0">
                <span
                  className="block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: "var(--color-warm-400)" }}
                />
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: "var(--color-warm-400)" }}
                  initial={{ opacity: 0.4, scale: 1 }}
                  animate={{ opacity: 0, scale: 2.5 }}
                  transition={{
                    duration: 1.2,
                    ease: "easeOut",
                    repeat: 1,
                  }}
                />
              </div>

              {/* Content */}
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                {/* Top row: label */}
                <span
                  className="font-mono text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {current.label}
                </span>

                {/* Title */}
                <span
                  className="font-sans text-[16px] font-medium leading-snug truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {current.title}
                </span>

                {/* Detail + agent row */}
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="font-mono text-[12px] truncate"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {current.detail}
                  </span>
                  <span
                    className="font-mono text-[11px] shrink-0 font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {current.agent}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
