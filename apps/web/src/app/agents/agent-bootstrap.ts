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
    "summary": "<rough challenge idea>",
    "messages": [{ "text": "<supporting context>" }]
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
2. Minimum create rule: provide at least one of summary, one message, or one file.
3. Inspect the returned session object and branch on state only:
   - awaiting_input -> inspect questions, ask your human only those missing questions, then call POST /api/authoring/sessions/:id/respond
   - ready -> call POST /api/authoring/sessions/:id/publish with funding: "sponsor"
   - rejected -> explain that Agora could not compile a valid challenge
   - published -> report success with challenge_id and tx_hash
4. Repeat respond until the session reaches ready or rejected.

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
    "context": "<optional extra context>"
  }'

Publish example:
${AGENT_BOOTSTRAP_PUBLISH_COMMAND}

Files:
- Agora does not accept Telegram-native file IDs.
- If Telegram or another platform gives you files, translate them into:
  - POST ${API_BASE_URL}/api/authoring/uploads
  - or fetchable URLs
- Use artifact refs in file answers.

Do not stop at:
- "I need more registration instructions"
- "Please explain the setup flow"
- "I have the docs link but do not know what to do"

This document is the setup flow.`;
}
