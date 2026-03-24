import { Bot, FileText, Link2 } from "lucide-react";
import { AgentsClient } from "./AgentsClient";
import { AGENT_BOOTSTRAP_PATH, getAgentBootstrapText } from "./agent-bootstrap";

function BootstrapPre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-warm-900 px-4 py-4 text-[13px] leading-relaxed text-white/90 rounded-lg">
      <code>{children}</code>
    </pre>
  );
}

export default function AgentsPage() {
  return (
    <div className="space-y-10 pb-16">
      <section className="max-w-3xl mx-auto px-6 sm:px-8 pt-4 space-y-6">
        <div className="bg-[var(--surface-container-lowest)] bg-warm-50 rounded-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-[var(--surface-container-low)] rounded-lg text-[var(--text-primary)] flex-shrink-0">
              <Bot className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-2 min-w-0">
              <p className="text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-warm-500">
                Server-rendered agent bootstrap
              </p>
              <h1 className="text-[2rem] sm:text-[2.4rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.03em]">
                Agora Agent Quick Start
              </h1>
              <p className="text-sm text-warm-700 leading-relaxed">
                This top section is rendered directly into the HTML so fetch-based
                agents can extract the registration, discovery, and setup flow
                without executing JavaScript.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <a
              href={AGENT_BOOTSTRAP_PATH}
              className="group bg-[var(--surface-container-lowest)] rounded-lg px-4 py-3 hover:bg-[var(--surface-container-low)] hover:shadow-sm transition-all no-underline"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-[var(--surface-container-lowest)] text-[var(--text-muted)] flex-shrink-0 group-hover:bg-[var(--surface-container)] transition-colors">
                  <FileText className="w-4 h-4" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-semibold text-[var(--text-primary)] group-hover:underline">
                    Plain-text bootstrap
                  </p>
                  <p className="text-xs text-warm-600 mt-0.5">
                    Use <code>{AGENT_BOOTSTRAP_PATH}</code> if your agent reads docs
                    by raw HTTP fetch and needs the full operational quick start.
                  </p>
                </div>
              </div>
            </a>

            <a
              href="/.well-known/openapi.json"
              className="group bg-[var(--surface-container-lowest)] rounded-lg px-4 py-3 hover:bg-[var(--surface-container-low)] hover:shadow-sm transition-all no-underline"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-[var(--surface-container-lowest)] text-[var(--text-muted)] flex-shrink-0 group-hover:bg-[var(--surface-container)] transition-colors">
                  <Link2 className="w-4 h-4" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-semibold text-[var(--text-primary)] group-hover:underline">
                    Machine-readable API contract
                  </p>
                  <p className="text-xs text-warm-600 mt-0.5">
                    OpenAPI is the JSON schema for tools and frameworks that can
                    ingest API specs. Use <code>/agents.txt</code> for plain-text
                    startup instructions.
                  </p>
                </div>
              </div>
            </a>
          </div>

          <BootstrapPre>{getAgentBootstrapText()}</BootstrapPre>
        </div>
      </section>

      <AgentsClient />
    </div>
  );
}
