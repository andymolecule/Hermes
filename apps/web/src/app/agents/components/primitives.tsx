"use client";

import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCopy,
  Flame,
  Zap,
} from "lucide-react";
import { useState } from "react";

/* ─── Copy Button ──────────────────────────────────────── */

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="absolute top-2.5 right-2.5 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
      title="Copy"
    >
      {copied ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
      ) : (
        <ClipboardCopy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/* ─── Code Block ───────────────────────────────────────── */

export function CodeBlock({
  children,
  title,
}: {
  children: string;
  title?: string;
}) {
  const code = children.trim();
  return (
    <div className="rounded-lg overflow-hidden bg-warm-900 relative group">
      {title && (
        <div className="px-4 py-2 bg-warm-900/90 border-b border-[var(--ghost-border)]">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/40">
            {title}
          </span>
        </div>
      )}
      <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed font-mono text-white/90">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

/* ─── Collapsible ─────────────────────────────────────── */

export function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-warm-50 hover:bg-warm-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 py-4 space-y-4 bg-white border-t border-[var(--ghost-border)]">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Step Component ───────────────────────────────────── */

export function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center bg-[var(--primary)] text-[var(--on-primary)] rounded-full text-sm font-mono font-bold">
          {number}
        </div>
        <div className="w-px flex-1 bg-[var(--ghost-border)] mt-2" />
      </div>
      <div className="pb-10 min-w-0 flex-1">
        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

/* ─── Callout ──────────────────────────────────────────── */

export function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "tip" | "warning";
  children: React.ReactNode;
}) {
  const styles = {
    info: {
      border: "border-accent-500/30",
      bg: "bg-accent-50",
      icon: <Circle className="w-4 h-4 text-accent-500" strokeWidth={2} />,
    },
    tip: {
      border: "border-green-600/30",
      bg: "bg-green-50",
      icon: <Zap className="w-4 h-4 text-green-600" strokeWidth={2} />,
    },
    warning: {
      border: "border-yellow-600/30",
      bg: "bg-yellow-50",
      icon: <Flame className="w-4 h-4 text-yellow-600" strokeWidth={2} />,
    },
  };
  const s = styles[type];
  return (
    <div
      className={`${s.border} ${s.bg} border rounded-lg px-4 py-3 flex gap-3`}
    >
      <div className="flex-shrink-0 mt-0.5">{s.icon}</div>
      <div className="text-sm text-warm-800 leading-relaxed">{children}</div>
    </div>
  );
}

/* ─── Card Link ────────────────────────────────────────── */

export function CardLink({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  href: string;
}) {
  const isExternal = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="group bg-[var(--surface-container-lowest)] rounded-lg p-5 flex items-start gap-4 hover:bg-[var(--surface-container-low)] hover:shadow-sm transition-all no-underline"
    >
      <div className="w-9 h-9 flex items-center justify-center bg-[var(--surface-container-low)] rounded-lg text-[var(--text-muted)] flex-shrink-0 transition-colors">
        <Icon className="w-4.5 h-4.5" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:underline">
          {title}
        </p>
        <p className="text-xs text-warm-600 mt-0.5">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-[var(--text-muted)] ml-auto flex-shrink-0 mt-1 group-hover:text-[var(--text-muted)] transition-colors" />
    </a>
  );
}

/* ─── Jump Link ────────────────────────────────────────── */

export function JumpLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      className="group bg-[var(--surface-container-lowest)] rounded-lg px-4 py-3 bg-white hover:bg-[var(--surface-container-low)] hover:shadow-sm transition-all no-underline"
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 flex items-center justify-center bg-[var(--surface-container-low)] rounded-lg text-[var(--text-muted)] flex-shrink-0 transition-colors">
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:underline">
            {title}
          </p>
          <p className="text-xs text-warm-600 mt-0.5">{description}</p>
        </div>
      </div>
    </a>
  );
}

/* ─── Tab Group ────────────────────────────────────────── */

export function TabGroup({
  tabs,
}: {
  tabs: { label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="flex overflow-x-auto border-b border-[var(--ghost-border)]">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
              active === i
                ? "text-[var(--text-primary)] border-b-2 border-[var(--text-primary)] -mb-px"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{tabs[active]?.content}</div>
    </div>
  );
}
