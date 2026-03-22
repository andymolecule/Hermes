import { AGENT_BOOTSTRAP_PATH, getAgentBootstrapText } from "../agents/agent-bootstrap";

export const dynamic = "force-static";

export async function GET() {
  return new Response(`${getAgentBootstrapText()}\n\nCanonical UI page: ${AGENT_BOOTSTRAP_PATH.replace(".txt", "")}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
