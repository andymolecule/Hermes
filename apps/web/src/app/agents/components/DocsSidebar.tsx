"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface NavItem {
  id: string;
  label: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Getting Started",
    items: [
      { id: "overview", label: "Overview" },
      { id: "bootstrap", label: "Agent Bootstrap" },
    ],
  },
  {
    group: "Direct Authoring",
    items: [
      { id: "register", label: "Register" },
      { id: "create-session", label: "Create Session" },
      { id: "respond", label: "Patch Session" },
      { id: "upload", label: "Upload Files" },
      { id: "publish", label: "Publish" },
    ],
  },
  {
    group: "Solver Path",
    items: [
      { id: "prerequisites", label: "Prerequisites" },
      { id: "install", label: "Install" },
      { id: "configure", label: "Configure" },
      { id: "verify", label: "Verify Setup" },
    ],
  },
  {
    group: "Solver Walkthrough",
    items: [
      { id: "discover", label: "Discover" },
      { id: "download", label: "Download" },
      { id: "build", label: "Build" },
      { id: "score-local", label: "Local Preview" },
      { id: "submit", label: "Submit" },
      { id: "track-scoring", label: "Track Scoring" },
      { id: "verify-finalize", label: "Verify & Finalize" },
      { id: "claim", label: "Claim" },
    ],
  },
  {
    group: "Reference",
    items: [
      { id: "privacy", label: "Submission Privacy" },
      { id: "env-vars", label: "Environment Variables" },
      { id: "cli-cheat-sheet", label: "CLI Cheat Sheet" },
      { id: "lifecycle", label: "Challenge Lifecycle" },
      { id: "troubleshooting", label: "Troubleshooting" },
    ],
  },
];

const NAV_IDS = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));

function useActiveSection() {
  const [activeId, setActiveId] = useState("overview");

  useEffect(() => {
    const sections = NAV_IDS.map((id) => document.getElementById(id)).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );

    if (sections.length === 0) return;

    const topOffset = 128;
    let frameId = 0;

    const updateActiveSection = () => {
      frameId = 0;

      let nextActiveId = sections[0]?.id ?? "overview";

      for (const section of sections) {
        const top = section.getBoundingClientRect().top;
        if (top - topOffset <= 0) {
          nextActiveId = section.id;
        } else {
          break;
        }
      }

      setActiveId((current) =>
        current === nextActiveId ? current : nextActiveId,
      );
    };

    const scheduleUpdate = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(updateActiveSection);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return useMemo(() => ({ activeId, setActiveId }), [activeId]);
}

function SidebarNav({
  activeId,
  onNavigate,
}: {
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <nav className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.group}>
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-warm-400 mb-2">
            {group.group}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`block w-full text-left text-[13px] font-medium rounded-lg px-3 py-2 transition-all duration-200 ${
                    activeId === item.id
                      ? "bg-[var(--surface-container-lowest)] text-[var(--text-primary)] shadow-[0_1px_3px_rgba(17,21,25,0.06)]"
                      : "text-warm-500 hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-lowest)]"
                  }`}
                  aria-current={activeId === item.id ? "location" : undefined}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ─── Desktop Sidebar (used inside DocsLayout aside slot) ── */

export function DocsSidebar() {
  const { activeId, setActiveId } = useActiveSection();

  const handleNavigate = (id: string) => {
    setActiveId(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return <SidebarNav activeId={activeId} onNavigate={handleNavigate} />;
}

/* ─── Mobile "On this page" panel (rendered at top of content on <lg) ── */

export function MobileSidebarPanel() {
  const [open, setOpen] = useState(false);
  const { activeId, setActiveId } = useActiveSection();

  const handleNavigate = (id: string) => {
    setActiveId(id);
    setOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="lg:hidden bg-[var(--surface-container-lowest)] rounded-lg mb-8">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-warm-50 hover:bg-warm-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          On this page
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-[var(--ghost-border)] bg-white">
          <SidebarNav activeId={activeId} onNavigate={handleNavigate} />
        </div>
      )}
    </div>
  );
}
