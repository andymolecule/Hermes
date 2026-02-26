import { challengeSpecSchema, loadConfig } from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with {
  type: "json",
};
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with {
  type: "json",
};
import {
  createSupabaseClient,
  getSubmissionByChainId,
  isEventIndexed,
  listChallenges,
  markEventIndexed,
  setChallengeFinalized,
  updateChallengeStatus,
  updateScore,
  upsertChallenge,
  upsertSubmission,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { type Abi, parseEventLogs } from "viem";
import yaml from "yaml";
import { getPublicClient } from "./client.js";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const POLL_INTERVAL_MS = 30_000;
const MAX_BLOCK_RANGE = BigInt(9_999);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function chunkedGetLogs(
  publicClient: ReturnType<typeof getPublicClient>,
  address: `0x${string}`,
  from: bigint,
  to: bigint,
) {
  let allLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_BLOCK_RANGE < to ? cursor + MAX_BLOCK_RANGE : to;
    const logs = await publicClient.getLogs({
      address,
      fromBlock: cursor,
      toBlock: end,
    });
    allLogs = allLogs.concat(Array.from(logs));
    cursor = end + BigInt(1);
  }
  return allLogs;
}

async function fetchChallengeSpec(specCid: string) {
  const raw = await getText(specCid);
  const parsed = yaml.parse(raw) as Record<string, unknown>;
  if (parsed.deadline instanceof Date) {
    parsed.deadline = parsed.deadline.toISOString();
  }
  return challengeSpecSchema.parse(parsed);
}

async function readSubmission(
  challengeAddress: `0x${string}`,
  submissionId: bigint,
  publicClient: ReturnType<typeof getPublicClient>,
) {
  const submission = (await publicClient.readContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
    functionName: "getSubmission",
    args: [submissionId],
  })) as {
    solver: `0x${string}`;
    resultHash: `0x${string}`;
    proofBundleHash: `0x${string}`;
    score: bigint;
    submittedAt: bigint;
    scored: boolean;
  };
  return submission;
}

async function readWinningSubmissionId(
  challengeAddress: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
) {
  const winner = (await publicClient.readContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
    functionName: "winningSubmissionId",
  })) as bigint;
  return winner;
}

async function blockTimestampIso(
  publicClient: ReturnType<typeof getPublicClient>,
  blockNumber: bigint | null,
) {
  if (!blockNumber) return new Date().toISOString();
  const block = await publicClient.getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

function eventArg(args: unknown, indexOrName: number | string): unknown {
  if (Array.isArray(args)) return args[indexOrName as number];
  if (args && typeof args === "object") {
    return (args as Record<string, unknown>)[indexOrName as string];
  }
  return undefined;
}

function parseRequiredBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  throw new Error(`Invalid event arg '${field}': expected bigint`);
}

function parseRequiredAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid event arg '${field}': expected address string`);
}

export async function runIndexer() {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const db = createSupabaseClient(true);

  const factoryAddress = config.HERMES_FACTORY_ADDRESS as `0x${string}`;

  // Resume from last indexed block instead of scanning from 0
  const { data: lastBlock, error: lastBlockError } = await db
    .from("indexed_events")
    .select("block_number")
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastBlockError) {
    throw new Error(
      `Failed to read indexer resume block: ${lastBlockError.message}`,
    );
  }
  // Re-read the last indexed block (instead of +1) to survive partial block processing;
  // indexed_events dedup keeps this replay idempotent.
  const envStartBlock = process.env.HERMES_INDEXER_START_BLOCK
    ? BigInt(process.env.HERMES_INDEXER_START_BLOCK)
    : BigInt(0);
  let fromBlock = lastBlock ? BigInt(lastBlock.block_number) : envStartBlock;

  // Use a serialized loop to avoid overlapping intervals.
  while (true) {
    try {
      const toBlock = await publicClient.getBlockNumber();
      const factoryLogs = await chunkedGetLogs(
        publicClient,
        factoryAddress,
        fromBlock,
        toBlock,
      );

      const parsedFactoryLogs = parseEventLogs({
        abi: HermesFactoryAbi,
        logs: factoryLogs,
        strict: false,
      }) as unknown as ParsedLog[];

      for (const log of parsedFactoryLogs) {
        if (!log.eventName || !log.transactionHash) continue;
        const txHash = log.transactionHash;
        const logIndex = Number(log.logIndex ?? 0);
        const already = await isEventIndexed(db, txHash, logIndex);
        if (already) continue;

        try {
          if (log.eventName === "ChallengeCreated") {
            const id = parseRequiredBigInt(
              eventArg(log.args, 0) ?? eventArg(log.args, "id"),
              "id",
            );
            const challengeAddr = parseRequiredAddress(
              eventArg(log.args, 1) ??
                eventArg(log.args, "challenge") ??
                eventArg(log.args, "challengeAddr") ??
                eventArg(log.args, "challengeAddress"),
              "challenge",
            );
            const poster = parseRequiredAddress(
              eventArg(log.args, 2) ??
                eventArg(log.args, "poster") ??
                eventArg(log.args, "creator"),
              "poster",
            );
            const reward = parseRequiredBigInt(
              eventArg(log.args, 3) ??
                eventArg(log.args, "rewardAmount") ??
                eventArg(log.args, "reward"),
              "rewardAmount",
            );

            const specCid = (await publicClient.readContract({
              address: challengeAddr,
              abi: HermesChallengeAbi,
              functionName: "specCid",
            })) as string;

            const spec = await fetchChallengeSpec(specCid);

            await upsertChallenge(db, {
              chain_id: config.HERMES_CHAIN_ID ?? 84532,
              contract_address: challengeAddr,
              factory_challenge_id: Number(id),
              poster_address: poster,
              title: spec.title,
              description: spec.description,
              domain: spec.domain,
              challenge_type: spec.type,
              spec_cid: specCid,
              dataset_train_cid: spec.dataset.train,
              dataset_test_cid: spec.dataset.test,
              scoring_container: spec.scoring.container,
              scoring_metric: spec.scoring.metric,
              minimum_score: spec.minimum_score ?? null,
              reward_amount: Number(reward) / 1_000_000,
              distribution_type: spec.reward.distribution,
              deadline: spec.deadline,
              dispute_window_hours: spec.dispute_window_hours ?? 48,
              max_submissions_per_wallet: spec.max_submissions_per_wallet ?? 3,
              status: "active",
              tx_hash: txHash,
            });
          }

          await markEventIndexed(
            db,
            txHash,
            logIndex,
            log.eventName,
            Number(log.blockNumber ?? 0),
          );
        } catch (error) {
          console.error("Failed to process factory event", {
            eventName: log.eventName,
            txHash,
            logIndex,
            error,
          });
          await markEventIndexed(
            db,
            txHash,
            logIndex,
            `${log.eventName}:invalid`,
            Number(log.blockNumber ?? 0),
          );
        }
      }

      const challenges = await listChallenges(db);
      for (const challenge of challenges) {
        const challengeAddress = challenge.contract_address as `0x${string}`;
        const challengeLogs = await chunkedGetLogs(
          publicClient,
          challengeAddress,
          fromBlock,
          toBlock,
        );

        const parsedChallengeLogs = parseEventLogs({
          abi: HermesChallengeAbi,
          logs: challengeLogs,
          strict: false,
        }) as unknown as ParsedLog[];

        for (const log of parsedChallengeLogs) {
          if (!log.eventName || !log.transactionHash) continue;
          const txHash = log.transactionHash;
          const logIndex = Number(log.logIndex ?? 0);
          const already = await isEventIndexed(db, txHash, logIndex);
          if (already) continue;

          try {
            if (log.eventName === "Submitted") {
              const submissionId = parseRequiredBigInt(
                eventArg(log.args, 0) ??
                  eventArg(log.args, "subId") ??
                  eventArg(log.args, "submissionId"),
                "submissionId",
              );
              const submission = await readSubmission(
                challengeAddress,
                submissionId,
                publicClient,
              );

              await upsertSubmission(db, {
                challenge_id: challenge.id,
                on_chain_sub_id: Number(submissionId),
                solver_address: submission.solver,
                result_hash: submission.resultHash,
                proof_bundle_hash: submission.proofBundleHash,
                score: submission.score.toString(),
                scored: submission.scored,
                submitted_at: new Date(
                  Number(submission.submittedAt) * 1000,
                ).toISOString(),
                tx_hash: txHash,
              });
            }

            if (log.eventName === "Scored") {
              const submissionId = parseRequiredBigInt(
                eventArg(log.args, 0) ??
                  eventArg(log.args, "subId") ??
                  eventArg(log.args, "submissionId"),
                "submissionId",
              );
              const score = parseRequiredBigInt(
                eventArg(log.args, 1) ?? eventArg(log.args, "score"),
                "score",
              );
              const proofBundleHash = parseRequiredAddress(
                eventArg(log.args, 2) ?? eventArg(log.args, "proofBundleHash"),
                "proofBundleHash",
              );

              const submission = await readSubmission(
                challengeAddress,
                submissionId,
                publicClient,
              );
              const existing = await getSubmissionByChainId(
                db,
                challenge.id,
                Number(submissionId),
              );

              const row = await upsertSubmission(db, {
                challenge_id: challenge.id,
                on_chain_sub_id: Number(submissionId),
                solver_address: submission.solver,
                result_hash: submission.resultHash,
                proof_bundle_hash: proofBundleHash,
                score: score.toString(),
                scored: true,
                submitted_at: new Date(
                  Number(submission.submittedAt) * 1000,
                ).toISOString(),
                scored_at: new Date().toISOString(),
                tx_hash: existing?.tx_hash ?? txHash,
              });

              await updateScore(db, {
                submission_id: row.id,
                score: score.toString(),
                proof_bundle_cid: existing?.proof_bundle_cid ?? "",
                proof_bundle_hash: proofBundleHash,
                scored_at: new Date().toISOString(),
              });
            }

            if (log.eventName === "Finalized") {
              const winnerOnChain = await readWinningSubmissionId(
                challengeAddress,
                publicClient,
              );
              const winnerRow = await getSubmissionByChainId(
                db,
                challenge.id,
                Number(winnerOnChain),
              );
              const finalizedAt = await blockTimestampIso(
                publicClient,
                log.blockNumber ?? null,
              );
              await setChallengeFinalized(
                db,
                challenge.id,
                finalizedAt,
                Number(winnerOnChain),
                winnerRow?.id ?? null,
              );
            }

            if (log.eventName === "Disputed") {
              await updateChallengeStatus(db, challenge.id, "disputed");
            }

            if (log.eventName === "Cancelled") {
              await updateChallengeStatus(db, challenge.id, "cancelled");
            }

            if (log.eventName === "DisputeResolved") {
              const rawWinner =
                eventArg(log.args, 0) ?? eventArg(log.args, "winnerSubId");
              const winnerOnChain = rawWinner
                ? parseRequiredBigInt(rawWinner, "winnerSubId")
                : null;
              const winnerRow = winnerOnChain
                ? await getSubmissionByChainId(
                    db,
                    challenge.id,
                    Number(winnerOnChain),
                  )
                : null;
              const finalizedAt = await blockTimestampIso(
                publicClient,
                log.blockNumber ?? null,
              );
              await setChallengeFinalized(
                db,
                challenge.id,
                finalizedAt,
                winnerOnChain ? Number(winnerOnChain) : null,
                winnerRow?.id ?? null,
              );
            }

            await markEventIndexed(
              db,
              txHash,
              logIndex,
              log.eventName,
              Number(log.blockNumber ?? 0),
            );
          } catch (error) {
            console.error("Failed to process challenge event", {
              challengeId: challenge.id,
              challengeAddress,
              eventName: log.eventName,
              txHash,
              logIndex,
              error,
            });
            await markEventIndexed(
              db,
              txHash,
              logIndex,
              `${log.eventName}:invalid`,
              Number(log.blockNumber ?? 0),
            );
          }
        }
      }

      fromBlock = toBlock + BigInt(1);
    } catch (error) {
      console.error("Indexer poll failed", error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

if (process.env.NODE_ENV !== "test") {
  runIndexer().catch((error) => {
    console.error("Indexer failed", error);
    process.exit(1);
  });
}
