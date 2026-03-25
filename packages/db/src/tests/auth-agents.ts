import assert from "node:assert/strict";
import {
  createAuthAgent,
  createAuthAgentKey,
  getAuthAgentById,
  getAuthAgentByTelegramBotId,
  getAuthAgentKeyByApiKeyHash,
  getAuthAgentKeyById,
  revokeAuthAgentKey,
  touchAuthAgentKeyLastUsed,
  updateAuthAgent,
} from "../queries/auth.js";

const createdAgentRow = {
  id: "11111111-1111-4111-8111-111111111111",
  telegram_bot_id: "bot_123456",
  agent_name: "AUBRAI",
  description: "Longevity research agent",
  created_at: "2026-03-22T00:00:00.000Z",
  updated_at: "2026-03-22T00:00:00.000Z",
};

const createdKeyRow = {
  id: "22222222-2222-4222-8222-222222222222",
  agent_id: createdAgentRow.id,
  key_label: "ci-runner",
  api_key_hash: "hash_1",
  revoked_at: null,
  created_at: "2026-03-22T00:00:00.000Z",
  last_used_at: null,
};

let insertedAgentPayload: Record<string, unknown> | null = null;
const insertAgentDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      insert(payload: Record<string, unknown>) {
        insertedAgentPayload = payload;
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async single() {
                return { data: createdAgentRow, error: null };
              },
            };
          },
        };
      },
    };
  },
} as never;

const createdAgent = await createAuthAgent(insertAgentDb, {
  telegramBotId: "bot_123456",
  agentName: "AUBRAI",
  description: "Longevity research agent",
});
assert.equal(createdAgent.id, createdAgentRow.id);
assert.deepEqual(insertedAgentPayload, {
  telegram_bot_id: "bot_123456",
  agent_name: "AUBRAI",
  description: "Longevity research agent",
  updated_at: insertedAgentPayload?.["updated_at"],
});

let updatedAgentPayload: Record<string, unknown> | null = null;
let updatedAgentId = "";
const updateAgentDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      update(payload: Record<string, unknown>) {
        updatedAgentPayload = payload;
        return {
          eq(field: string, value: string) {
            assert.equal(field, "id");
            updatedAgentId = value;
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async single() {
                    return {
                      data: {
                        ...createdAgentRow,
                        agent_name: "AUBRAI 2",
                        updated_at: "2026-03-22T01:00:00.000Z",
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

const updatedAgent = await updateAuthAgent(updateAgentDb, {
  id: createdAgentRow.id,
  agentName: "AUBRAI 2",
});
assert.equal(updatedAgent.agent_name, "AUBRAI 2");
assert.equal(updatedAgentId, createdAgentRow.id);
assert.equal(updatedAgentPayload?.["agent_name"], "AUBRAI 2");
assert.equal(typeof updatedAgentPayload?.["updated_at"], "string");

let selectedField = "";
let selectedValue = "";
const selectAgentDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      select(selection: string) {
        assert.equal(selection, "*");
        return {
          eq(field: string, value: string) {
            selectedField = field;
            selectedValue = value;
            return this;
          },
          async maybeSingle() {
            return { data: createdAgentRow, error: null };
          },
        };
      },
    };
  },
} as never;

const byTelegramBotId = await getAuthAgentByTelegramBotId(
  selectAgentDb,
  "bot_123456",
);
assert.equal(byTelegramBotId?.telegram_bot_id, "bot_123456");
assert.equal(selectedField, "telegram_bot_id");
assert.equal(selectedValue, "bot_123456");

const byId = await getAuthAgentById(selectAgentDb, createdAgentRow.id);
assert.equal(byId?.id, createdAgentRow.id);
assert.equal(selectedField, "id");
assert.equal(selectedValue, createdAgentRow.id);

let insertedKeyPayload: Record<string, unknown> | null = null;
const insertKeyDb = {
  from(table: string) {
    assert.equal(table, "auth_agent_keys");
    return {
      insert(payload: Record<string, unknown>) {
        insertedKeyPayload = payload;
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async single() {
                return { data: createdKeyRow, error: null };
              },
            };
          },
        };
      },
    };
  },
} as never;

const createdKey = await createAuthAgentKey(insertKeyDb, {
  agentId: createdAgentRow.id,
  apiKeyHash: "hash_1",
  keyLabel: "ci-runner",
});
assert.equal(createdKey.id, createdKeyRow.id);
assert.deepEqual(insertedKeyPayload, {
  agent_id: createdAgentRow.id,
  api_key_hash: "hash_1",
  key_label: "ci-runner",
});

let keySelectField = "";
let keySelectValue = "";
let keySelectField2 = "";
let keySelectValue2 = "";
const selectKeyDb = {
  from(table: string) {
    assert.equal(table, "auth_agent_keys");
    return {
      select(selection: string) {
        assert.equal(selection, "*");
        return {
          eq(field: string, value: string) {
            if (!keySelectField) {
              keySelectField = field;
              keySelectValue = value;
              return this;
            }
            keySelectField2 = field;
            keySelectValue2 = value;
            return this;
          },
          is(field: string, value: null) {
            assert.equal(field, "revoked_at");
            assert.equal(value, null);
            return this;
          },
          async maybeSingle() {
            return { data: createdKeyRow, error: null };
          },
        };
      },
    };
  },
} as never;

const byApiKeyHash = await getAuthAgentKeyByApiKeyHash(selectKeyDb, "hash_1");
assert.equal(byApiKeyHash?.api_key_hash, "hash_1");
assert.equal(keySelectField, "api_key_hash");
assert.equal(keySelectValue, "hash_1");

keySelectField = "";
keySelectValue = "";
keySelectField2 = "";
keySelectValue2 = "";
const byKeyId = await getAuthAgentKeyById(selectKeyDb, {
  agentId: createdAgentRow.id,
  keyId: createdKeyRow.id,
});
assert.equal(byKeyId?.id, createdKeyRow.id);
assert.equal(keySelectField, "agent_id");
assert.equal(keySelectValue, createdAgentRow.id);
assert.equal(keySelectField2, "id");
assert.equal(keySelectValue2, createdKeyRow.id);

let revokedKeyPayload: Record<string, unknown> | null = null;
let revokedAgentId = "";
let revokedKeyId = "";
const revokeKeyDb = {
  from(table: string) {
    assert.equal(table, "auth_agent_keys");
    return {
      update(payload: Record<string, unknown>) {
        revokedKeyPayload = payload;
        return {
          eq(field: string, value: string) {
            if (!revokedAgentId) {
              assert.equal(field, "agent_id");
              revokedAgentId = value;
              return this;
            }
            assert.equal(field, "id");
            revokedKeyId = value;
            return this;
          },
          is(field: string, value: null) {
            assert.equal(field, "revoked_at");
            assert.equal(value, null);
            return this;
          },
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async maybeSingle() {
                return {
                  data: {
                    ...createdKeyRow,
                    revoked_at: "2026-03-22T02:00:00.000Z",
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

const revokedKey = await revokeAuthAgentKey(revokeKeyDb, {
  agentId: createdAgentRow.id,
  keyId: createdKeyRow.id,
});
assert.equal(revokedKey?.revoked_at, "2026-03-22T02:00:00.000Z");
assert.equal(revokedAgentId, createdAgentRow.id);
assert.equal(revokedKeyId, createdKeyRow.id);
assert.equal(typeof revokedKeyPayload?.["revoked_at"], "string");

let touchedKeyId = "";
let touchedPayload: Record<string, unknown> | null = null;
const touchKeyDb = {
  from(table: string) {
    assert.equal(table, "auth_agent_keys");
    return {
      update(payload: Record<string, unknown>) {
        touchedPayload = payload;
        return {
          eq(field: string, value: string) {
            assert.equal(field, "id");
            touchedKeyId = value;
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
} as never;

await touchAuthAgentKeyLastUsed(touchKeyDb, createdKeyRow.id);
assert.equal(touchedKeyId, createdKeyRow.id);
assert.equal(typeof touchedPayload?.["last_used_at"], "string");

console.log("auth agent queries passed");
