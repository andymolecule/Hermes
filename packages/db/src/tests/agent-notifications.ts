import assert from "node:assert/strict";
import {
  claimNextAgentNotification,
  disableAgentNotificationEndpoint,
  enqueueAgentNotification,
  enqueueClaimableNotificationsForChallenge,
  getAgentNotificationEndpointById,
  listClaimableNotificationCandidatesForChallenge,
  upsertAgentNotificationEndpoint,
} from "../queries/agent-notifications.js";

const endpointRow = {
  id: "11111111-1111-4111-8111-111111111111",
  agent_id: "22222222-2222-4222-8222-222222222222",
  webhook_url: "https://agent.example.com/webhook",
  signing_secret_ciphertext: "ciphertext",
  signing_secret_key_version: "v1",
  status: "active" as const,
  last_delivery_at: null,
  last_error: null,
  created_at: "2026-03-27T00:00:00.000Z",
  updated_at: "2026-03-27T00:00:00.000Z",
  disabled_at: null,
};

function createAwaitableQuery<T>(result: T) {
  const promise = Promise.resolve(result);
  const query = Object.assign(promise, {
    eq() {
      return query;
    },
    is() {
      return query;
    },
    in() {
      return query;
    },
    order() {
      return query;
    },
    async maybeSingle() {
      return result;
    },
    async single() {
      return result;
    },
  });

  return query;
}

let capturedEndpointUpsert!: {
  payload: Record<string, unknown>;
  onConflict: string | undefined;
};
const endpointUpsertDb = {
  from(table: string) {
    assert.equal(table, "agent_notification_endpoints");
    return {
      upsert(
        payload: Record<string, unknown>,
        options?: { onConflict?: string },
      ) {
        capturedEndpointUpsert = {
          payload,
          onConflict: options?.onConflict,
        };
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async single() {
                return { data: endpointRow, error: null };
              },
            };
          },
        };
      },
    };
  },
} as never;

const upsertedEndpoint = await upsertAgentNotificationEndpoint(
  endpointUpsertDb,
  {
    agent_id: endpointRow.agent_id,
    webhook_url: endpointRow.webhook_url,
    signing_secret_ciphertext: endpointRow.signing_secret_ciphertext,
    signing_secret_key_version: endpointRow.signing_secret_key_version,
  },
);
assert.equal(upsertedEndpoint.id, endpointRow.id);
assert.equal(capturedEndpointUpsert.onConflict, "agent_id");
assert.equal(capturedEndpointUpsert.payload.agent_id, endpointRow.agent_id);
assert.equal(capturedEndpointUpsert.payload.status, "active");

const endpointByIdDb = {
  from(table: string) {
    assert.equal(table, "agent_notification_endpoints");
    return {
      select(selection: string) {
        assert.equal(selection, "*");
        return {
          eq(field: string, value: string) {
            assert.equal(field, "id");
            assert.equal(value, endpointRow.id);
            return createAwaitableQuery({
              data: endpointRow,
              error: null,
            });
          },
        };
      },
    };
  },
} as never;

const endpointById = await getAgentNotificationEndpointById(
  endpointByIdDb,
  endpointRow.id,
);
assert.equal(endpointById?.id, endpointRow.id);

let disabledAgentId = "";
const disableDb = {
  from(table: string) {
    assert.equal(table, "agent_notification_endpoints");
    return {
      update(payload: Record<string, unknown>) {
        assert.equal(payload.status, "disabled");
        assert.equal(typeof payload.updated_at, "string");
        assert.equal(typeof payload.disabled_at, "string");
        return {
          eq(field: string, value: string) {
            assert.equal(field, "agent_id");
            disabledAgentId = value;
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        ...endpointRow,
                        status: "disabled",
                        disabled_at: payload.disabled_at as string,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  },
} as never;

const disabledEndpoint = await disableAgentNotificationEndpoint(
  disableDb,
  endpointRow.agent_id,
);
assert.equal(disabledEndpoint?.status, "disabled");
assert.equal(disabledAgentId, endpointRow.agent_id);

let capturedOutboxPayload!: Record<string, unknown>;
const enqueueDb = {
  from(table: string) {
    assert.equal(table, "agent_notification_outbox");
    return {
      upsert(
        payload: Record<string, unknown>,
        options?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) {
        capturedOutboxPayload = payload;
        assert.equal(options?.onConflict, "dedupe_key");
        assert.equal(options?.ignoreDuplicates, true);
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async maybeSingle() {
                return {
                  data: {
                    id: "33333333-3333-4333-8333-333333333333",
                    ...payload,
                    attempts: 0,
                    max_attempts: 5,
                    next_attempt_at: payload.next_attempt_at,
                    locked_at: null,
                    locked_by: null,
                    delivered_at: null,
                    last_error: null,
                    created_at: "2026-03-27T00:00:00.000Z",
                    updated_at: payload.updated_at,
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    };
  },
} as never;

await enqueueAgentNotification(enqueueDb, {
  agent_id: endpointRow.agent_id,
  endpoint_id: endpointRow.id,
  challenge_id: "44444444-4444-4444-8444-444444444444",
  solver_address: "0x00000000000000000000000000000000000000AA",
  event_type: "payout.claimable",
  dedupe_key:
    "payout.claimable:44444444-4444-4444-8444-444444444444:22222222-2222-4222-8222-222222222222:0x00000000000000000000000000000000000000aa",
  payload_json: { ok: true },
});
assert.equal(
  capturedOutboxPayload.solver_address,
  "0x00000000000000000000000000000000000000aa",
);

await assert.rejects(
  () =>
    claimNextAgentNotification(
      {
        async rpc() {
          return {
            data: null,
            error: {
              message:
                "Could not find the function public.claim_next_agent_notification(p_worker_id, p_lease_ms)",
            },
          };
        },
      } as never,
      "worker-1",
      60_000,
    ),
  /001_baseline\.sql/,
);

const candidateDb = {
  from(table: string) {
    if (table === "challenges") {
      return {
        select(selection: string) {
          assert.equal(
            selection,
            "id,title,contract_address,distribution_type,status",
          );
          return {
            eq(field: string, value: string) {
              assert.equal(field, "id");
              assert.equal(value, "challenge-1");
              return createAwaitableQuery({
                data: {
                  id: "66666666-6666-4666-8666-666666666666",
                  title: "KRAS ranking challenge",
                  contract_address:
                    "0x0000000000000000000000000000000000000001",
                  distribution_type: "top_3",
                  status: "finalized",
                },
                error: null,
              });
            },
          };
        },
      };
    }

    if (table === "challenge_payouts") {
      return {
        select(selection: string) {
          assert.equal(
            selection,
            "challenge_id,solver_address,winning_on_chain_sub_id,rank,amount,claimed_at",
          );
          return {
            eq(field: string, value: string) {
              assert.equal(field, "challenge_id");
              assert.equal(value, "challenge-1");
              return createAwaitableQuery({
                data: [
                  {
                    challenge_id: "66666666-6666-4666-8666-666666666666",
                    solver_address:
                      "0x00000000000000000000000000000000000000aa",
                    winning_on_chain_sub_id: 7,
                    rank: 1,
                    amount: "6.000000",
                    claimed_at: null,
                  },
                  {
                    challenge_id: "66666666-6666-4666-8666-666666666666",
                    solver_address:
                      "0x00000000000000000000000000000000000000aa",
                    winning_on_chain_sub_id: 8,
                    rank: 2,
                    amount: "2.500000",
                    claimed_at: null,
                  },
                ],
                error: null,
              });
            },
          };
        },
      };
    }

    if (table === "submissions") {
      return {
        select(selection: string) {
          assert.equal(
            selection,
            "id,submission_intent_id,on_chain_sub_id,solver_address",
          );
          return {
            eq(field: string, value: string) {
              assert.equal(field, "challenge_id");
              assert.equal(value, "challenge-1");
              return {
                in(inField: string, values: number[]) {
                  assert.equal(inField, "on_chain_sub_id");
                  assert.deepEqual(values, [7, 8]);
                  return createAwaitableQuery({
                    data: [
                      {
                        id: "77777777-7777-4777-8777-777777777777",
                        submission_intent_id: "intent-7",
                        on_chain_sub_id: 7,
                        solver_address:
                          "0x00000000000000000000000000000000000000aa",
                      },
                      {
                        id: "88888888-8888-4888-8888-888888888888",
                        submission_intent_id: "intent-8",
                        on_chain_sub_id: 8,
                        solver_address:
                          "0x00000000000000000000000000000000000000aa",
                      },
                    ],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    }

    if (table === "submission_intents") {
      return {
        select(selection: string) {
          assert.equal(selection, "id,submitted_by_agent_id");
          return {
            in(field: string, values: string[]) {
              assert.equal(field, "id");
              assert.deepEqual(values, ["intent-7", "intent-8"]);
              return createAwaitableQuery({
                data: [
                  {
                    id: "intent-7",
                    submitted_by_agent_id:
                      "22222222-2222-4222-8222-222222222222",
                  },
                  {
                    id: "intent-8",
                    submitted_by_agent_id:
                      "22222222-2222-4222-8222-222222222222",
                  },
                ],
                error: null,
              });
            },
          };
        },
      };
    }

    if (table === "agent_notification_endpoints") {
      return {
        select(selection: string) {
          assert.equal(selection, "id,agent_id,status");
          return {
            eq(field: string, value: string) {
              assert.equal(field, "status");
              assert.equal(value, "active");
              return {
                in(inField: string, values: string[]) {
                  assert.equal(inField, "agent_id");
                  assert.deepEqual(values, [
                    "22222222-2222-4222-8222-222222222222",
                  ]);
                  return createAwaitableQuery({
                    data: [
                      {
                        id: endpointRow.id,
                        agent_id: endpointRow.agent_id,
                        status: "active",
                      },
                    ],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    }

    throw new Error(`Unexpected table ${table}`);
  },
} as never;

const candidates = await listClaimableNotificationCandidatesForChallenge(
  candidateDb,
  "challenge-1",
);
assert.equal(candidates.length, 1);
const [candidate] = candidates;
assert.ok(candidate);
assert.equal(candidate.agent_id, endpointRow.agent_id);
assert.equal(candidate.challenge_id, "66666666-6666-4666-8666-666666666666");
assert.equal(
  candidate.solver_address,
  "0x00000000000000000000000000000000000000aa",
);
assert.equal(candidate.claimable_amount, "8500000");
assert.deepEqual(
  candidate.entries.map((entry) => entry.rank),
  [1, 2],
);

const mixedAttributionCandidateDb = {
  from(table: string) {
    if (table === "submission_intents") {
      return {
        select(selection: string) {
          assert.equal(selection, "id,submitted_by_agent_id");
          return {
            in(field: string, values: string[]) {
              assert.equal(field, "id");
              assert.deepEqual(values, ["intent-7", "intent-8"]);
              return createAwaitableQuery({
                data: [
                  {
                    id: "intent-7",
                    submitted_by_agent_id:
                      "22222222-2222-4222-8222-222222222222",
                  },
                  {
                    id: "intent-8",
                    submitted_by_agent_id: null,
                  },
                ],
                error: null,
              });
            },
          };
        },
      };
    }

    return (candidateDb as { from: (table: string) => unknown }).from(table);
  },
} as never;

const mixedAttributionCandidates =
  await listClaimableNotificationCandidatesForChallenge(
    mixedAttributionCandidateDb,
    "challenge-1",
  );
assert.equal(mixedAttributionCandidates.length, 0);

let enqueueClaimableCalls = 0;
const enqueueClaimableDb = {
  from(table: string) {
    if (table === "agent_notification_outbox") {
      return {
        upsert(payload: Record<string, unknown>) {
          enqueueClaimableCalls += 1;
          assert.equal(payload.event_type, "payout.claimable");
          assert.equal(
            payload.solver_address,
            "0x00000000000000000000000000000000000000aa",
          );
          return {
            select(selection: string) {
              assert.equal(selection, "*");
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: "55555555-5555-4555-8555-555555555555",
                      ...payload,
                      attempts: 0,
                      max_attempts: 5,
                      next_attempt_at: payload.next_attempt_at,
                      locked_at: null,
                      locked_by: null,
                      delivered_at: null,
                      last_error: null,
                      created_at: "2026-03-27T00:00:00.000Z",
                      updated_at: payload.updated_at,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    }

    return (candidateDb as { from: (table: string) => unknown }).from(table);
  },
} as never;

const queuedNotifications = await enqueueClaimableNotificationsForChallenge(
  enqueueClaimableDb,
  "challenge-1",
  "2026-03-27T00:10:00.000Z",
);
assert.equal(enqueueClaimableCalls, 1);
assert.equal(queuedNotifications.length, 1);
assert.equal(
  (queuedNotifications[0]?.payload_json as { type?: string }).type,
  "payout.claimable",
);

console.log("agent notification query checks passed");
