import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubmissionStatusEventStream,
  waitForSubmissionStatusDataWithReader,
} from "../src/routes/submissions.js";

const basePayload = {
  refs: {
    intentId: "33333333-3333-4333-8333-333333333333",
    submissionId: "22222222-2222-4222-8222-222222222222",
    challengeId: "11111111-1111-4111-8111-111111111111",
    challengeAddress: "0x0000000000000000000000000000000000000001",
    onChainSubmissionId: 0,
  },
  phase: "scoring_queued" as const,
  submission: {
    id: "22222222-2222-4222-8222-222222222222",
    challenge_id: "11111111-1111-4111-8111-111111111111",
    challenge_address: "0x0000000000000000000000000000000000000001",
    on_chain_sub_id: 0,
    solver_address: "0x0000000000000000000000000000000000000002",
    score: null,
    scored: false,
    submitted_at: "2026-03-17T00:00:00.000Z",
    scored_at: null,
    refs: {
      submissionId: "22222222-2222-4222-8222-222222222222",
      challengeId: "11111111-1111-4111-8111-111111111111",
      challengeAddress: "0x0000000000000000000000000000000000000001",
      onChainSubmissionId: 0,
    },
  },
  proofBundle: null,
  job: {
    status: "queued",
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    nextAttemptAt: null,
    lockedAt: null,
  },
  lastError: null,
  lastErrorPhase: null,
  scoringStatus: "pending" as const,
  terminal: false,
  recommendedPollSeconds: 15,
};

async function readStreamText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    text += decoder.decode(value, { stream: !done });
    if (done) {
      break;
    }
  }

  return text;
}

function parseSseEvents(text: string) {
  return text
    .replaceAll("\r\n", "\n")
    .trim()
    .split("\n\n")
    .map((record) => {
      const eventLine = record
        .split("\n")
        .find((line) => line.startsWith("event: "));
      const dataLine = record
        .split("\n")
        .find((line) => line.startsWith("data: "));
      return {
        event: eventLine?.slice("event: ".length) ?? "message",
        data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null,
      };
    });
}

test("wait helper returns immediately for terminal submissions", async () => {
  const data = await waitForSubmissionStatusDataWithReader({
    submissionId: "22222222-2222-4222-8222-222222222222",
    timeoutSeconds: 30,
    readStatus: async () => ({
      ...basePayload,
      phase: "scored",
      submission: {
        ...basePayload.submission,
        score: "100",
        scored: true,
        scored_at: "2026-03-17T00:10:00.000Z",
      },
      proofBundle: { reproducible: true },
      job: {
        ...basePayload.job,
        status: "scored",
      },
      scoringStatus: "complete",
      terminal: true,
      recommendedPollSeconds: 60,
    }),
    sleepImpl: async () => {
      throw new Error("sleep should not be called");
    },
  });

  assert.equal(data.terminal, true);
  assert.equal(data.waitedMs, 0);
  assert.equal(data.timedOut, false);
});

test("wait helper returns when the submission changes before timing out", async () => {
  let reads = 0;
  const data = await waitForSubmissionStatusDataWithReader({
    submissionId: "22222222-2222-4222-8222-222222222222",
    timeoutSeconds: 30,
    readStatus: async () => {
      reads += 1;
      if (reads === 1) {
        return basePayload;
      }
      return {
        ...basePayload,
        phase: "scoring_running",
        job: {
          ...basePayload.job,
          status: "running",
          lockedAt: "2026-03-17T00:01:00.000Z",
        },
      };
    },
    sleepImpl: async () => undefined,
  });

  assert.equal(reads, 2);
  assert.equal(data.job?.status, "running");
  assert.equal(data.timedOut, false);
});

test("submission status event stream emits a terminal event immediately", async () => {
  const stream = buildSubmissionStatusEventStream({
    submissionId: "22222222-2222-4222-8222-222222222222",
    readStatus: async () => ({
      ...basePayload,
      phase: "scored",
      submission: {
        ...basePayload.submission,
        score: "100",
        scored: true,
        scored_at: "2026-03-17T00:10:00.000Z",
      },
      proofBundle: { reproducible: true },
      job: {
        ...basePayload.job,
        status: "scored",
      },
      scoringStatus: "complete",
      terminal: true,
      recommendedPollSeconds: 60,
    }),
    waitForStatus: async () => {
      throw new Error("waitForStatus should not be called");
    },
  });

  const events = parseSseEvents(await readStreamText(stream));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "terminal");
  assert.equal(events[0]?.data?.terminal, true);
});

test("submission status event stream emits keepalive updates before completion", async () => {
  let waits = 0;
  const stream = buildSubmissionStatusEventStream({
    submissionId: "22222222-2222-4222-8222-222222222222",
    readStatus: async () => basePayload,
    waitForStatus: async () => {
      waits += 1;
      if (waits === 1) {
        return {
          ...basePayload,
          phase: "scoring_running",
          waitedMs: 20_000,
          timedOut: true,
        };
      }
      return {
        ...basePayload,
        phase: "scored",
        submission: {
          ...basePayload.submission,
          score: "100",
          scored: true,
          scored_at: "2026-03-17T00:10:00.000Z",
        },
        proofBundle: { reproducible: true },
        job: {
          ...basePayload.job,
          status: "scored",
        },
        scoringStatus: "complete",
        terminal: true,
        recommendedPollSeconds: 60,
        waitedMs: 5_000,
        timedOut: false,
      };
    },
  });

  const events = parseSseEvents(await readStreamText(stream));
  assert.deepEqual(
    events.map((event) => event.event),
    ["status", "keepalive", "terminal"],
  );
  assert.equal(events[1]?.data?.waitedMs, 20_000);
  assert.equal(events[2]?.data?.terminal, true);
});
