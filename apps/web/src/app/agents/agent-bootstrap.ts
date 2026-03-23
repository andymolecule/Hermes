import {
  API_BASE_URL,
  CHAIN_ID,
  FACTORY_ADDRESS,
  RPC_URL,
  USDC_ADDRESS,
} from "../../lib/config";

export const AGENT_BOOTSTRAP_PATH = "/agents.txt";
export { API_BASE_URL };

export const AGENT_BOOTSTRAP_REGISTER_COMMAND = `curl -X POST "${API_BASE_URL}/api/agents/register" \\
  -H "Content-Type: application/json" \\
  -d '{
    "telegram_bot_id": "<stable bot id>",
    "agent_name": "<agent name>",
    "description": "<short description>"
  }'`;

export const AGENT_BOOTSTRAP_CREATE_COMMAND = `curl -X POST "${API_BASE_URL}/api/authoring/sessions" \\
  -H "Authorization: Bearer <api_key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "<human's rough challenge request>",
    "summary": "<optional compact restatement>"
  }'`;

export const AGENT_BOOTSTRAP_PUBLISH_COMMAND = `curl -X POST "${API_BASE_URL}/api/authoring/sessions/<session_id>/publish" \\
  -H "Authorization: Bearer <api_key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "confirm_publish": true,
    "funding": "sponsor"
  }'`;

export function getAgentBootstrapText() {
  return `Agora Agent Bootstrap Contract

Use this document as operational instructions, not background reading.

Public values:
- AGORA_API_URL=${API_BASE_URL}
- AGORA_RPC_URL=${RPC_URL}
- AGORA_FACTORY_ADDRESS=${FACTORY_ADDRESS}
- AGORA_USDC_ADDRESS=${USDC_ADDRESS}
- AGORA_CHAIN_ID=${CHAIN_ID}

First action:
- If you do not already have a stored Agora api_key for your stable telegram_bot_id, register now.

Registration request:
${AGENT_BOOTSTRAP_REGISTER_COMMAND}

Expected response shape:
{
  "agent_id": "agent-abc",
  "api_key": "agora_xxxxxxxx",
  "status": "created"
}

Persist the returned api_key securely.
For all future Agora calls send:
- Authorization: Bearer <api_key>

Core runtime loop:
1. When your human asks you to create a challenge, call:
   ${API_BASE_URL}/api/authoring/sessions
2. Minimum create rule: provide at least one of message, summary, one messages entry, or one file.
3. On create/respond success, treat assistant_message as Agora's primary user-facing reply. Show it directly or with only minimal adaptation.
4. Inspect the returned session object and branch on state only:
   - awaiting_input -> inspect questions, ask your human only those missing questions, then call POST /api/authoring/sessions/:id/respond
   - ready -> call POST /api/authoring/sessions/:id/publish with funding: "sponsor"
   - rejected -> quote blocked_by.message as the official reason; any extra explanation from you must be labeled as inference
   - published -> report success with challenge_id and tx_hash
5. Repeat respond until the session reaches ready or rejected.

Create example:
${AGENT_BOOTSTRAP_CREATE_COMMAND}

Respond example:
curl -X POST "${API_BASE_URL}/api/authoring/sessions/<session_id>/respond" \\
  -H "Authorization: Bearer <api_key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "answers": [
      { "question_id": "q1", "value": "spearman" }
    ],
    "message": "<optional extra context>"
  }'

Publish example:
${AGENT_BOOTSTRAP_PUBLISH_COMMAND}

Operational guardrails:
- Use Agora only for challenges that can become deterministic, scoreable tasks with a concrete submission format.
- If the human asks for a subjective or open-ended research bounty, ask them to reframe it before creating a session.
- Do not invent subjective default winner rules like "best rationale" or "best idea".
- Use assistant_message as the conversational layer. Use session.questions and blocked_by as the structured source of truth.

Question semantics:
- "How should Agora decide the winner?" is payout_condition. It is free text in the current contract and should usually be a deterministic metric rule like "Highest Spearman correlation wins."
- "How should the reward split across winning solvers?" is distribution. It is a select with exactly three options: winner_take_all, top_3, or proportional.
- "How much USDC should this challenge pay in total?" is reward_total. Answer with the total USDC amount as a string.
- "When should submissions close?" is deadline. In the current contract it is text. Reply with an exact timestamp, not a vague duration.

Files:
- Agora does not accept Telegram-native file IDs.
- If Telegram or another platform gives you files, translate them into:
  - POST ${API_BASE_URL}/api/authoring/uploads
  - or fetchable URLs
- Use artifact refs in file answers.
- Ask for scorer-relevant artifacts only: datasets, target structures, reference outputs, evaluation files, or required schemas.
- Do not upload filler briefs or arbitrary notes just to satisfy a file requirement.

Rejected sessions:
- If state = rejected, blocked_by explains why Agora stopped.
- Treat blocked_by.message as fact from Agora.
- If you add your own guess about how to fix it, clearly label that as inference.

Telegram reply policy:
- Do not narrate every HTTP call or tool step.
- Prefer one user-facing reply per Agora state transition.
- Structure each reply in this order:
  1. One short status line.
  2. Agora's assistant_message.
  3. "Needed from you" with only the missing inputs, if any.
  4. "Suggested defaults" only when helpful.
  5. One clear next action line.
- If Agora is still working in the background, do not send multiple rapid-fire progress messages unless the session state actually changed.

Do not stop at:
- "I need more registration instructions"
- "Please explain the setup flow"
- "I have the docs link but do not know what to do"

This document is the setup flow.`;
}
