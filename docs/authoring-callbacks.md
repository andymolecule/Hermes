# Authoring Callbacks

Callback contract for external authoring hosts such as Beach Science.

This document defines how Agora notifies an external host that an authoring session changed state, how hosts should verify those callbacks, and how hosts should reconcile current state after receiving them.

## Purpose

Authoring callbacks are a host-sync mechanism, not a source of truth.

Agora remains canonical for:
- session state
- needs-input state
- compile state
- publish state

External hosts should treat callbacks as:
- a reliable prompt to refresh host UI state
- not as the only state they store forever

If a callback is missed, the host should recover by calling the session endpoint again.

## Registration

External hosts register a callback endpoint with:

`POST /api/integrations/beach/sessions/:id/webhook`

The callback URL must be a public HTTPS URL.

Direct Agora `/post` drafts are not eligible for host callbacks.

## Events

Agora currently emits these lifecycle events:

- `draft_compiled`
- `draft_compile_failed`
- `draft_published`
- `challenge_created`
- `challenge_finalized`

The callback body is a JSON object shaped like `AuthoringCallbackEvent`.

Draft lifecycle events include:
- `event`
- `occurred_at`
- `draft_id` (this is the persisted session id)
- `provider`
- `state`
- `card`

Challenge lifecycle events include:
- `event`
- `occurred_at`
- `draft_id` (this is the persisted session id)
- `provider`
- `challenge`

Important: retries resend the original event payload. They do not mutate to the latest session state.

That is intentional:
- the callback says what happened
- the session endpoint says what is true now

After any callback, hosts should fetch:

`GET /api/integrations/beach/sessions/:id`

if they need the latest session state.

## Headers

Agora sends these headers on each callback:

- `content-type: application/json`
- `x-agora-event`
- `x-agora-event-id`
- `x-agora-timestamp`
- `x-agora-signature` when a partner callback secret is configured

### `x-agora-event-id`

This is a deterministic idempotency key derived from:

- `draft_id`
- `event`
- `occurred_at`

Hosts should use `x-agora-event-id` to deduplicate retries.

Recommended rule:
- store seen event ids for at least 24 hours
- ignore duplicates after successful processing

## Signature Verification

When a callback secret is configured, Agora signs:

`<x-agora-timestamp>.<raw_request_body>`

with HMAC-SHA256 and sends:

`x-agora-signature: sha256=<hex_digest>`

Hosts should verify the signature against the raw request body, not a re-serialized JSON object.

### Required verification steps

1. Read the raw request body bytes.
2. Read `x-agora-timestamp`.
3. Compute `HMAC_SHA256(secret, timestamp + "." + rawBody)`.
4. Compare against `x-agora-signature` using a timing-safe comparison.
5. Reject the callback if the signature does not match.

## Replay Protection

Signature verification alone is not enough. Hosts must also reject stale callbacks.

Recommended replay rule:
- parse `x-agora-timestamp` as ISO-8601
- reject if it is more than 5 minutes older or newer than host wall-clock time

Recommended behavior:
- `401` or `403` for invalid signature
- `400` for malformed timestamp
- `409` or `422` for duplicate `x-agora-event-id`

This means host-side verification should be:
- signature-valid
- timestamp-valid
- event-id-not-seen

all three, not just one.

## Retry Model

Agora attempts callback delivery immediately.

If the first attempt fails:
- Agora persists a durable callback delivery record
- the delivery can be retried by the callback sweep path

Current operator path:

`POST /api/authoring/callbacks/sweep`

This endpoint is internal and protected by the authoring operator token (`AGORA_AUTHORING_OPERATOR_TOKEN`).

The retry model is at-least-once, not exactly-once.

Hosts must therefore be idempotent.

## Host Processing Model

Recommended host workflow:

1. Verify signature.
2. Verify timestamp within the replay window.
3. Deduplicate by `x-agora-event-id`.
4. Parse the callback body.
5. Update lightweight host UI state immediately if helpful.
6. Fetch the latest draft card from Agora.
7. Persist that latest card as host display state.

This keeps the host correct even if:
- callbacks arrive late
- callbacks are retried
- multiple draft updates happen quickly

## Example Verification Logic

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyAgoraCallback(input: {
  rawBody: string;
  timestamp: string;
  signatureHeader: string;
  secret: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const timestampMs = Date.parse(input.timestamp);
  if (Number.isNaN(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp" as const };
  }

  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(nowMs - timestampMs) > maxSkewMs) {
    return { ok: false, reason: "stale_timestamp" as const };
  }

  const expected = `sha256=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(input.signatureHeader);
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: "invalid_signature" as const };
  }

  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: "invalid_signature" as const };
  }

  return { ok: true as const };
}
```

## Operational Notes

- Callback secrets should be distinct from partner bearer keys when possible.
- Hosts should log:
  - event id
  - event type
  - draft id
  - verification result
  - replay rejection reason
- Hosts should not trust callback payloads from cleartext HTTP endpoints.
- If host state and Agora state disagree, Agora wins.

## Design Principle

Keep the boundary simple:

- callbacks are push signals
- session endpoints are pull truth

That avoids turning callback delivery into a second source of truth.
