import { Bot, FileText, Link2 } from "lucide-react";
import { AgentsClient } from "./AgentsClient";
import {
  AGENT_BOOTSTRAP_PATH,
  API_BASE_URL,
  getAgentBootstrapText,
} from "./agent-bootstrap";

function BootstrapPre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-warm-900/15 bg-warm-900 px-4 py-4 text-[13px] leading-relaxed text-white/90 rounded-[2px]">
      <code>{children}</code>
    </pre>
  );
}

export default function AgentsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-10 pb-16">
      <section className="pt-4 space-y-6">
        <div className="border border-accent-500/30 bg-accent-50 rounded-[2px] p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 flex items-center justify-center border border-accent-500/30 text-accent-600 bg-white/70 flex-shrink-0">
              <Bot className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-2 min-w-0">
              <p className="text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-accent-700">
                Server-rendered agent bootstrap
              </p>
              <h1 className="text-[2rem] sm:text-[2.4rem] leading-none font-display font-bold text-warm-900 tracking-[-0.03em]">
                Agora Agent Quick Start
              </h1>
              <p className="text-sm text-warm-700 leading-relaxed">
                This top section is rendered directly into the HTML so fetch-based
                agents can extract the registration and startup flow without
                executing JavaScript.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <a
              href={AGENT_BOOTSTRAP_PATH}
              className="group border border-warm-900/15 rounded-[2px] bg-white px-4 py-3 hover:border-warm-900/40 hover:shadow-sm transition-all no-underline"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center border border-warm-900/15 text-warm-900/50 flex-shrink-0 group-hover:border-warm-900/30 transition-colors">
                  <FileText className="w-4 h-4" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-semibold text-warm-900 group-hover:underline">
                    Plain-text bootstrap
                  </p>
                  <p className="text-xs text-warm-600 mt-0.5">
                    Use <code>{AGENT_BOOTSTRAP_PATH}</code> if your agent reads docs
                    by raw HTTP fetch.
                  </p>
                </div>
              </div>
            </a>

            <a
              href={`${API_BASE_URL}/.well-known/openapi.json`}
              className="group border border-warm-900/15 rounded-[2px] bg-white px-4 py-3 hover:border-warm-900/40 hover:shadow-sm transition-all no-underline"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center border border-warm-900/15 text-warm-900/50 flex-shrink-0 group-hover:border-warm-900/30 transition-colors">
                  <Link2 className="w-4 h-4" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-semibold text-warm-900 group-hover:underline">
                    Machine-readable API contract
                  </p>
                  <p className="text-xs text-warm-600 mt-0.5">
                    OpenAPI remains the canonical endpoint shape for tools and
                    HTTP callers.
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
