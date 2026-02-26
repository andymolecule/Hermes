import http from "node:http";
import { getPublicClient } from "@hermes/chain";
import { challengeSpecSchema, loadConfig } from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
  setSubmissionResultCid,
  upsertChallenge,
  upsertSubmission,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { type Abi, parseEventLogs, verifyMessage } from "viem";
import yaml from "yaml";
import {
  consumeNonce,
  createNonce,
  createSession,
  deleteSession,
  getSession,
} from "./lib/session-store";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const WRITE_LIMIT = 5;
const WRITE_WINDOW_MS = 60 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const writeBuckets = new Map<string, { count: number; resetAt: number }>();

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += next.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "JSON body too large.");
    }
    chunks.push(next);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function getCookie(req: http.IncomingMessage, key: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    const [k, ...rest] = pair.split("=");
    if (k === key) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSessionCookie(res: http.ServerResponse, token: string) {
  res.setHeader(
    "Set-Cookie",
    `hermes_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`,
  );
}

function clearSessionCookie(res: http.ServerResponse) {
  res.setHeader(
    "Set-Cookie",
    "hermes_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax",
  );
}

function parseSessionAddress(req: http.IncomingMessage) {
  const token = getCookie(req, "hermes_session");
  const session = getSession(token);
  return session?.address ?? null;
}

function ensureWriteAllowed(address: string, routeKey: string) {
  const key = `${address}:${routeKey}`;
  const now = Date.now();
  const current = writeBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WRITE_WINDOW_MS }
      : current;
  if (bucket.count >= WRITE_LIMIT) {
    throw new HttpError(
      429,
      "Rate limit exceeded: max 5 write requests per hour.",
    );
  }
  bucket.count += 1;
  writeBuckets.set(key, bucket);
}

function parseSiweLikeMessage(message: string) {
  const addressMatch = message.match(/(0x[a-fA-F0-9]{40})/);
  const nonceMatch = message.match(/Nonce:\s*([A-Za-z0-9]+)/i);
  return {
    address: addressMatch?.[1]?.toLowerCase() as `0x${string}` | undefined,
    nonce: nonceMatch?.[1],
  };
}

function getLogArg(
  args: readonly unknown[] | Record<string, unknown> | undefined,
  index: number,
  key: string,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args[index];
  if (typeof args === "object" && args !== null && key in args) {
    return (args as Record<string, unknown>)[key];
  }
  return undefined;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  try {
    if (req.method === "OPTIONS") return json(res, 200, { ok: true });
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/healthz") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/api/auth/nonce") {
      return json(res, 200, { nonce: createNonce() });
    }

    if (req.method === "POST" && path === "/api/auth/verify") {
      const body = await readJsonBody(req);
      const message = String(body.message ?? "");
      const signature = String(body.signature ?? "");
      const { address, nonce } = parseSiweLikeMessage(message);
      if (!address || !nonce || !consumeNonce(nonce)) {
        return json(res, 401, { error: "SIWE verification failed." });
      }
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
        return json(res, 401, { error: "Invalid signature format." });
      }
      const valid = await verifyMessage({
        address,
        message,
        signature: signature as `0x${string}`,
      });
      if (!valid) {
        return json(res, 401, { error: "SIWE signature verification failed." });
      }
      const { token, expiresAt } = createSession(address);
      setSessionCookie(res, token);
      return json(res, 200, {
        ok: true,
        address,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    if (req.method === "POST" && path === "/api/auth/logout") {
      deleteSession(getCookie(req, "hermes_session"));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/api/auth/session") {
      const session = getSession(getCookie(req, "hermes_session"));
      if (!session) return json(res, 200, { authenticated: false });
      return json(res, 200, {
        authenticated: true,
        address: session.address,
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    }

    if (req.method === "GET" && path === "/api/challenges") {
      const db = createSupabaseClient(false);
      const limitRaw = url.searchParams.get("limit");
      const minRewardRaw = url.searchParams.get("min_reward");
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const minReward = minRewardRaw ? Number(minRewardRaw) : undefined;
      if (limitRaw && (Number.isNaN(limit) || (limit ?? 0) <= 0)) {
        return json(res, 400, { error: "limit must be a positive number." });
      }
      if (minRewardRaw && Number.isNaN(minReward)) {
        return json(res, 400, { error: "min_reward must be a valid number." });
      }
      const rows = await listChallengesWithDetails(db, {
        status: url.searchParams.get("status") ?? undefined,
        domain: url.searchParams.get("domain") ?? undefined,
        posterAddress: url.searchParams.get("poster_address") ?? undefined,
        limit,
      });
      const filtered =
        minReward === undefined
          ? rows
          : rows.filter(
              (row: { reward_amount: unknown }) =>
                Number(row.reward_amount) >= minReward,
            );
      return json(res, 200, { data: filtered });
    }

    if (req.method === "POST" && path === "/api/challenges") {
      const address = parseSessionAddress(req);
      if (!address) return json(res, 401, { error: "Unauthorized." });
      ensureWriteAllowed(address, path);

      const body = await readJsonBody(req);
      const specCid = String(body.specCid ?? "");
      const txHash = String(body.txHash ?? "");
      if (!specCid || !txHash.startsWith("0x")) {
        return json(res, 400, { error: "specCid and txHash are required." });
      }

      const db = createSupabaseClient(true);
      const config = loadConfig();
      const publicClient = getPublicClient();
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      const logs = parseEventLogs({
        abi: HermesFactoryAbi,
        logs: receipt.logs,
        strict: false,
      });
      const event = logs.find(
        (log: { eventName?: string }) => log.eventName === "ChallengeCreated",
      );
      if (!event)
        return json(res, 400, { error: "ChallengeCreated not found." });
      const args = event.args as unknown as
        | readonly unknown[]
        | Record<string, unknown>;
      const challengeId = getLogArg(args, 0, "id");
      const challengeAddress = getLogArg(args, 1, "challenge");
      const posterAddress = getLogArg(args, 2, "poster");
      const reward = getLogArg(args, 3, "reward");
      if (
        challengeId === undefined ||
        typeof challengeAddress !== "string" ||
        reward === undefined ||
        typeof posterAddress !== "string"
      ) {
        return json(res, 400, { error: "Invalid ChallengeCreated payload." });
      }

      const raw = await getText(specCid);
      const parsed = yaml.parse(raw) as Record<string, unknown>;
      if (parsed.deadline instanceof Date)
        parsed.deadline = parsed.deadline.toISOString();
      const spec = challengeSpecSchema.parse(parsed);

      await upsertChallenge(db, {
        chain_id: config.HERMES_CHAIN_ID ?? 84532,
        contract_address: challengeAddress,
        factory_challenge_id: Number(challengeId),
        poster_address: posterAddress,
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

      return json(res, 200, { ok: true, challengeAddress });
    }

    const challengeMatch = path.match(/^\/api\/challenges\/([0-9a-f-]+)$/i);
    if (req.method === "GET" && challengeMatch) {
      const challengeId = challengeMatch[1];
      if (!challengeId)
        return json(res, 400, { error: "Invalid challenge id." });
      const db = createSupabaseClient(false);
      const challenge = await getChallengeById(db, challengeId);
      const submissions = await listSubmissionsForChallenge(db, challengeId);
      const leaderboard = submissions
        .filter((row: { score: unknown }) => row.score !== null)
        .sort(
          (a: { score: unknown }, b: { score: unknown }) =>
            Number(b.score ?? 0) - Number(a.score ?? 0),
        );
      return json(res, 200, { data: { challenge, submissions, leaderboard } });
    }

    const leaderboardMatch = path.match(
      /^\/api\/challenges\/([0-9a-f-]+)\/leaderboard$/i,
    );
    if (req.method === "GET" && leaderboardMatch) {
      const challengeId = leaderboardMatch[1];
      if (!challengeId)
        return json(res, 400, { error: "Invalid challenge id." });
      const db = createSupabaseClient(false);
      const submissions = await listSubmissionsForChallenge(db, challengeId);
      return json(res, 200, {
        data: submissions
          .filter((row: { score: unknown }) => row.score !== null)
          .sort(
            (a: { score: unknown }, b: { score: unknown }) =>
              Number(b.score ?? 0) - Number(a.score ?? 0),
          ),
      });
    }

    const submissionMatch = path.match(/^\/api\/submissions\/([0-9a-f-]+)$/i);
    if (req.method === "GET" && submissionMatch) {
      const submissionId = submissionMatch[1];
      if (!submissionId)
        return json(res, 400, { error: "Invalid submission id." });
      const db = createSupabaseClient(false);
      const submission = await getSubmissionById(db, submissionId);
      const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
      return json(res, 200, { data: { submission, proofBundle } });
    }

    if (req.method === "POST" && path === "/api/submissions") {
      const address = parseSessionAddress(req);
      if (!address) return json(res, 401, { error: "Unauthorized." });
      ensureWriteAllowed(address, path);

      const body = await readJsonBody(req);
      const challengeId = String(body.challengeId ?? "");
      const resultCid = String(body.resultCid ?? "");
      const txHash = String(body.txHash ?? "");
      if (!challengeId || !resultCid || !txHash.startsWith("0x")) {
        return json(res, 400, {
          error: "challengeId, resultCid, txHash are required.",
        });
      }

      const db = createSupabaseClient(true);
      const challenge = await getChallengeById(db, challengeId);
      const publicClient = getPublicClient();
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      const logs = parseEventLogs({
        abi: HermesChallengeAbi,
        logs: receipt.logs,
        strict: false,
      });
      const event = logs.find(
        (log: { eventName?: string }) => log.eventName === "Submitted",
      );
      if (!event)
        return json(res, 400, { error: "Submitted event not found." });
      const args = event.args as unknown as
        | readonly unknown[]
        | Record<string, unknown>;
      const subId = getLogArg(args, 0, "subId");
      if (subId === undefined || typeof subId !== "bigint") {
        return json(res, 400, { error: "Invalid Submitted payload." });
      }

      const onChain = (await publicClient.readContract({
        address: challenge.contract_address as `0x${string}`,
        abi: HermesChallengeAbi,
        functionName: "getSubmission",
        args: [subId],
      })) as unknown as {
        solver: `0x${string}`;
        resultHash: `0x${string}`;
        proofBundleHash: `0x${string}`;
        score: bigint;
        submittedAt: bigint;
        scored: boolean;
      };

      const row = await upsertSubmission(db, {
        challenge_id: challengeId,
        on_chain_sub_id: Number(subId),
        solver_address: onChain.solver,
        result_hash: onChain.resultHash,
        result_cid: resultCid,
        proof_bundle_hash: onChain.proofBundleHash,
        score: onChain.score.toString(),
        scored: onChain.scored,
        submitted_at: new Date(
          Number(onChain.submittedAt) * 1000,
        ).toISOString(),
        tx_hash: txHash,
      });
      await setSubmissionResultCid(db, challengeId, Number(subId), resultCid);
      return json(res, 200, { ok: true, submission: row });
    }

    if (req.method === "POST" && path === "/api/verify") {
      const address = parseSessionAddress(req);
      if (!address) return json(res, 401, { error: "Unauthorized." });
      ensureWriteAllowed(address, path);

      const body = await readJsonBody(req);
      const proofBundleId = String(body.proofBundleId ?? "");
      const computedScore = Number(body.computedScore);
      const matchesOriginal = Boolean(body.matchesOriginal);
      const logCid = body.logCid ? String(body.logCid) : null;
      if (!proofBundleId || Number.isNaN(computedScore)) {
        return json(res, 400, {
          error: "proofBundleId and computedScore are required.",
        });
      }
      const db = createSupabaseClient(true);
      const verification = await createVerification(db, {
        proof_bundle_id: proofBundleId,
        verifier_address: address,
        computed_score: computedScore,
        matches_original: matchesOriginal,
        log_cid: logCid,
      });
      return json(res, 200, { ok: true, verification });
    }

    if (req.method === "GET" && path === "/api/stats") {
      const db = createSupabaseClient(false);
      const [
        { count: challengesCount },
        { count: submissionsCount },
        { count: scoredCount },
      ] = await Promise.all([
        db.from("challenges").select("*", { count: "exact", head: true }),
        db.from("submissions").select("*", { count: "exact", head: true }),
        db
          .from("submissions")
          .select("*", { count: "exact", head: true })
          .eq("scored", true),
      ]);
      return json(res, 200, {
        data: {
          challengesTotal: challengesCount ?? 0,
          submissionsTotal: submissionsCount ?? 0,
          scoredSubmissions: scoredCount ?? 0,
        },
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(res, error.status, { error: error.message });
    }
    return json(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

const port = Number(process.env.HERMES_API_PORT ?? 3000);
const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(port, () => {
  console.log(`Hermes API listening on http://localhost:${port}`);
});
