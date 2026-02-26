import { useState, useEffect } from 'react';
import {
  Terminal, Database, Shield, Zap, Activity, LayoutDashboard, Settings,
  Clock, Users, Upload, CheckCircle2, AlertTriangle, Radio
} from 'lucide-react';

// ─── Mock Data ───────────────────────────────────────────

const CHALLENGES = [
  {
    id: "CH-001",
    title: "Reproduce Figure 3 from Gladyshev 2024 longevity clock",
    domain: "longevity",
    type: "reproducibility",
    reward: 500,
    submissions: 12,
    status: "active" as const,
    deadline: "48h 12m",
  },
  {
    id: "CH-042",
    title: "Virtual screening: Identify novel inhibitors for KRAS G12C",
    domain: "drug_discovery",
    type: "docking",
    reward: 2500,
    submissions: 3,
    status: "active" as const,
    deadline: "12d 08h",
  },
  {
    id: "CH-108",
    title: "Predict protein stability from mutated sequences (AlphaFold 3 subset)",
    domain: "protein_design",
    type: "prediction",
    reward: 1200,
    submissions: 27,
    status: "verification" as const,
    deadline: "Dispute 48h",
  },
  {
    id: "CH-007",
    title: "Single-cell RNA-seq clustering — optimize speed & accuracy tradeoff",
    domain: "omics",
    type: "optimization",
    reward: 800,
    submissions: 8,
    status: "active" as const,
    deadline: "72h 00m",
  },
  {
    id: "CH-019",
    title: "Replicate methylation age prediction from Horvath 2024 multi-tissue clock",
    domain: "longevity",
    type: "reproducibility",
    reward: 750,
    submissions: 5,
    status: "active" as const,
    deadline: "5d 14h",
  },
];

interface LogEntry {
  time: string;
  agent: string;
  action: string;
  detail: string;
  type: 'submit' | 'verify' | 'system' | 'error';
}

const INITIAL_LOGS: LogEntry[] = [
  { time: "14:22:11", agent: "0x4B…A1c3", action: "Submitted proof bundle", detail: "CH-001 → QmXy…z7Fa", type: "submit" },
  { time: "14:21:05", agent: "Oracle", action: "Score verified", detail: "CH-042 — Score: 0.9842", type: "verify" },
  { time: "14:18:33", agent: "0x9F…2Ca8", action: "Fetched dataset", detail: "CH-042 — ipfs://Qm…4kB", type: "system" },
  { time: "14:12:01", agent: "0x1A…8Bd2", action: "Deployed scorer", detail: "ghcr.io/hermes/repro:v1", type: "system" },
  { time: "14:05:44", agent: "0x4B…A1c3", action: "Staked computation", detail: "50 USDC on CH-001", type: "submit" },
  { time: "13:59:12", agent: "System", action: "New bounty posted", detail: "CH-108 — 1,200 USDC", type: "system" },
  { time: "13:55:00", agent: "0xE2…9F1a", action: "Verification failed", detail: "CH-007 — timeout after 300s", type: "error" },
  { time: "13:48:22", agent: "Oracle", action: "Block synced", detail: "Base #18,402,331", type: "system" },
];

// ─── Helpers ─────────────────────────────────────────────

function timeNow() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function randomAddr() {
  return "0x" + Math.random().toString(16).slice(2, 4).toUpperCase() + "…" + Math.random().toString(16).slice(2, 6).toUpperCase();
}

const NEW_LOG_TEMPLATES: (() => LogEntry)[] = [
  () => ({ time: timeNow(), agent: randomAddr(), action: "Computing score", detail: `CH-${String(Math.floor(Math.random() * 120)).padStart(3, '0')}`, type: "submit" }),
  () => ({ time: timeNow(), agent: "Oracle", action: "Block synced", detail: `Base #${(18402000 + Math.floor(Math.random() * 1000)).toLocaleString()}`, type: "system" }),
  () => ({ time: timeNow(), agent: randomAddr(), action: "Proof rejected", detail: "Scorer hash mismatch", type: "error" }),
  () => ({ time: timeNow(), agent: randomAddr(), action: "Submitted results", detail: `CH-${String(Math.floor(Math.random() * 120)).padStart(3, '0')} — Score: ${(0.7 + Math.random() * 0.29).toFixed(4)}`, type: "submit" }),
  () => ({ time: timeNow(), agent: "Oracle", action: "Score verified", detail: `CH-${String(Math.floor(Math.random() * 120)).padStart(3, '0')} — PASS`, type: "verify" }),
];

// ─── Render Helpers ──────────────────────────────────────

function FeedIcon({ type }: { type: LogEntry['type'] }) {
  const cls = `feed-icon ${type}`;
  switch (type) {
    case 'submit': return <div className={cls}><Upload size={14} /></div>;
    case 'verify': return <div className={cls}><CheckCircle2 size={14} /></div>;
    case 'error': return <div className={cls}><AlertTriangle size={14} /></div>;
    default: return <div className={cls}><Radio size={14} /></div>;
  }
}

// ─── App ─────────────────────────────────────────────────

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('bounties');

  useEffect(() => {
    const id = setInterval(() => {
      const gen = NEW_LOG_TEMPLATES[Math.floor(Math.random() * NEW_LOG_TEMPLATES.length)];
      setLogs(prev => [gen(), ...prev].slice(0, 30));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const totalPool = CHALLENGES.reduce((s, c) => s + c.reward, 0);
  const totalSubs = CHALLENGES.reduce((s, c) => s + c.submissions, 0);

  return (
    <div className="dashboard-layout">

      {/* ─── Sidebar ─── */}
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-mark">
              {/* Molecule wordmark-style icon — clean hexagonal mark */}
              <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2L25.26 8.5V21.5L14 28L2.74 21.5V8.5L14 2Z" fill="#001B3D" />
                <circle cx="14" cy="9" r="2.2" fill="white" />
                <circle cx="9.5" cy="17" r="2.2" fill="white" />
                <circle cx="18.5" cy="17" r="2.2" fill="white" />
                <line x1="14" y1="9" x2="9.5" y2="17" stroke="white" strokeWidth="1.4" />
                <line x1="14" y1="9" x2="18.5" y2="17" stroke="white" strokeWidth="1.4" />
                <line x1="9.5" y1="17" x2="18.5" y2="17" stroke="white" strokeWidth="1.4" />
              </svg>
            </div>
            <div className="logo-text-block">
              <span className="logo-primary">molecule</span>
              <span className="logo-secondary">Hermes Protocol</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <ul className="sidebar-nav">
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'bounties' ? 'active' : ''}`} onClick={() => setActiveTab('bounties')}>
            <LayoutDashboard size={16} /> Active Bounties
            <span className="nav-badge">{CHALLENGES.filter(c => c.status === 'active').length}</span>
          </button>
          </li>
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'verification' ? 'active' : ''}`} onClick={() => setActiveTab('verification')}>
            <Clock size={16} /> In Verification
            <span className="nav-badge">{CHALLENGES.filter(c => c.status === 'verification').length}</span>
          </button>
          </li>
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'datasets' ? 'active' : ''}`} onClick={() => setActiveTab('datasets')}>
            <Database size={16} /> Datasets
          </button>
          </li>
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'runners' ? 'active' : ''}`} onClick={() => setActiveTab('runners')}>
            <Shield size={16} /> Scoring Runners
          </button>
          </li>
        </ul>

        <div className="sidebar-section-label">Protocol</div>
        <ul className="sidebar-nav">
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
            <Activity size={16} /> Analytics
          </button>
          </li>
          <li>
          <button type="button" className={`sidebar-nav-item ${activeTab === 'params' ? 'active' : ''}`} onClick={() => setActiveTab('params')}>
            <Settings size={16} /> Parameters
          </button>
          </li>
        </ul>

        <div className="sidebar-footer">
          <div className="network-status">
            <div className="network-status-row">
              <span className="network-status-label">Network</span>
              <span className="network-status-value"><span className="status-dot"></span>Base Mainnet</span>
            </div>
            <div className="network-status-row">
              <span className="network-status-label">Oracle</span>
              <span className="network-status-value">Synced</span>
            </div>
            <div className="network-status-row">
              <span className="network-status-label">RPC</span>
              <span className="network-status-value">Alchemy</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ─── Main ─── */}
      <main className="main-content">
        {/* Page Header */}
        <header className="page-header">
          <div className="page-header-left">
            <h1 className="page-title">Computational Bounties</h1>
            <p className="page-subtitle">Open science challenges with deterministic scoring and on-chain USDC settlement.</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-secondary"><Terminal size={14} /> CLI Docs</button>
            <button className="btn btn-primary"><Zap size={14} /> Post Bounty</button>
          </div>
        </header>

        {/* Stats */}
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-label">Active Bounties</span>
            <span className="stat-value">{CHALLENGES.filter(c => c.status === 'active').length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Pool</span>
            <span className="stat-value">{totalPool.toLocaleString()}<span className="stat-unit">USDC</span></span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Submissions</span>
            <span className="stat-value">{totalSubs}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Agents Active</span>
            <span className="stat-value">38</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          {['all', 'longevity', 'drug_discovery', 'protein_design', 'omics'].map(f => (
            <button
              key={f}
              className={`filter-chip ${activeFilter === f ? 'active' : ''}`}
              onClick={() => setActiveFilter(f)}
            >
              {f === 'all' ? 'All Domains' : f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Challenge Table */}
        <div className="challenge-list">
          <div className="challenge-list-header">
            <span>ID</span>
            <span>Challenge</span>
            <span style={{ textAlign: 'right' }}>Reward</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Deadline</span>
          </div>
          {CHALLENGES
            .filter(c => activeFilter === 'all' || c.domain === activeFilter)
            .map(ch => (
              <div key={ch.id} className="challenge-row">
                <span className="challenge-id">{ch.id}</span>
                <div className="challenge-info">
                  <span className="challenge-title">{ch.title}</span>
                  <div className="challenge-meta">
                    <span className="tag tag-domain">{ch.domain.replace('_', ' ')}</span>
                    <span className="tag tag-type">{ch.type}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Users size={10} /> {ch.submissions} submissions
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="challenge-reward">{ch.reward.toLocaleString()}</div>
                  <div className="reward-label">USDC</div>
                </div>
                <span className={`status-badge ${ch.status}`}>
                  {ch.status === 'active' ? 'Active' : 'Verifying'}
                </span>
                <div className="challenge-deadline">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                    <Clock size={11} /> {ch.deadline}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </main>

      {/* ─── Activity Feed ─── */}
      <aside className="activity-panel">
        <div className="activity-header">
          <span className="activity-title"><Activity size={14} /> Activity</span>
          <span className="live-indicator">Live</span>
        </div>

        <div className="activity-feed">
          {logs.map((log, i) => (
            <div key={`${log.time}-${i}`} className="feed-entry">
              <FeedIcon type={log.type} />
              <div className="feed-body">
                <div className="feed-headline">
                  <strong>{log.agent}</strong> {log.action}
                </div>
                <div className="feed-detail">{log.detail}</div>
              </div>
              <span className="feed-time">{log.time}</span>
            </div>
          ))}
        </div>

        <div className="activity-footer">
          <div className="activity-stat">
            <span className="activity-stat-label">24h Volume</span>
            <span className="activity-stat-value">$12.4k</span>
          </div>
          <div className="activity-stat">
            <span className="activity-stat-label">Success Rate</span>
            <span className="activity-stat-value">94.2%</span>
          </div>
          <div className="activity-stat">
            <span className="activity-stat-label">Avg. Score</span>
            <span className="activity-stat-value">0.891</span>
          </div>
          <div className="activity-stat">
            <span className="activity-stat-label">Protocol Fee</span>
            <span className="activity-stat-value">5%</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
