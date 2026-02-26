import { challengeSpecSchema, loadConfig } from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
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
import { getPublicClient } from "./client";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const POLL_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  args: readonly unknown[];
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

export async function runIndexer() {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const db = createSupabaseClient(true);

  const factoryAddress = config.HERMES_FACTORY_ADDRESS as `0x${string}`;
  let fromBlock = BigInt(0);

  // Use a serialized loop to avoid overlapping intervals.
  while (true) {
    try {
      const toBlock = await publicClient.getBlockNumber();
      const factoryLogs = await publicClient.getLogs({
        address: factoryAddress,
        fromBlock,
        toBlock,
      });

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

        if (log.eventName === "ChallengeCreated") {
          const [id, challengeAddr, poster, reward] = log.args as unknown as [
            bigint,
            `0x${string}`,
            `0x${string}`,
            bigint,
          ];

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
      }

      const challenges = await listChallenges(db);
      for (const challenge of challenges) {
        const challengeAddress = challenge.contract_address as `0x${string}`;
        const challengeLogs = await publicClient.getLogs({
          address: challengeAddress,
          fromBlock,
          toBlock,
        });

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

          if (log.eventName === "Submitted") {
            const [submissionId] = log.args as unknown as [bigint];
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
            const [submissionId, score, proofBundleHash] =
              log.args as unknown as [bigint, bigint, `0x${string}`];

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
            const winnerOnChain = (log.args as unknown as [bigint])[0] ?? null;
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
