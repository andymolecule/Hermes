function printUsage() {
  console.log(`Usage: pnpm recover:authoring-publishes -- [--stale-minutes=<minutes>] [--draft-id=<uuid>]

Reconcile stale sponsor-budget reservations for authoring publishes.

Options:
  --stale-minutes=<minutes>  Treat reservations older than this many minutes as stale. Default: 30
  --draft-id=<uuid>          Limit reconciliation to one draft id
  --help                     Show this help and exit`);
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  const staleMinutesArg = argv.find((arg) =>
    arg.startsWith("--stale-minutes="),
  );
  const draftIdArg = argv.find((arg) => arg.startsWith("--draft-id="));
  const staleMinutes = Number(staleMinutesArg?.split("=")[1] ?? "30");

  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    throw new Error(
      "stale-minutes must be a positive number. Next step: pass --stale-minutes=<minutes> and retry.",
    );
  }

  return {
    help: false,
    staleMinutes,
    draftId: draftIdArg?.split("=")[1] ?? null,
  };
}

const parsedArgs = parseArgs(process.argv.slice(2));
if (parsedArgs.help) {
  printUsage();
  process.exit(0);
}

const {
  REQUIRED_RUNTIME_SCHEMA_CHECKS,
  assertRuntimeDatabaseSchema,
  consumeAuthoringSponsorBudgetReservation,
  createSupabaseClient,
  getChallengeByTxHash,
  getPublishedDraftMetadataByDraftId,
  listStaleAuthoringSponsorBudgetReservations,
  releaseAuthoringSponsorBudgetReservation,
} = await import("../packages/db/src/index.ts");

const db = createSupabaseClient(true);
await assertRuntimeDatabaseSchema(
  db,
  REQUIRED_RUNTIME_SCHEMA_CHECKS.filter((check) =>
    new Set([
      "challenge_source_attribution_columns",
      "authoring_drafts_table",
      "authoring_sponsor_budget_reservations_table",
    ]).has(check.id),
  ),
);

const cutoffIso = new Date(
  Date.now() - parsedArgs.staleMinutes * 60 * 1000,
).toISOString();
const reservations = await listStaleAuthoringSponsorBudgetReservations(
  db,
  cutoffIso,
);

const rows = parsedArgs.draftId
  ? reservations.filter((row) => row.draft_id === parsedArgs.draftId)
  : reservations;

const consumed = [];
const released = [];
const pending = [];

for (const row of rows) {
  const publishedDraftMetadata = await getPublishedDraftMetadataByDraftId(
    db,
    row.draft_id,
  );
  if (publishedDraftMetadata?.challenge_id) {
    await consumeAuthoringSponsorBudgetReservation(db, {
      draftId: row.draft_id,
      challengeId: publishedDraftMetadata.challenge_id,
      txHash: row.tx_hash,
    });
    consumed.push({
      draftId: row.draft_id,
      challengeId: publishedDraftMetadata.challenge_id,
      reason: "published_draft_metadata",
    });
    continue;
  }

  if (row.tx_hash) {
    const challenge = await getChallengeByTxHash(db, row.tx_hash);
    if (challenge?.id) {
      await consumeAuthoringSponsorBudgetReservation(db, {
        draftId: row.draft_id,
        challengeId: challenge.id,
        txHash: row.tx_hash,
      });
      consumed.push({
        draftId: row.draft_id,
        challengeId: challenge.id,
        reason: "challenge_tx_hash",
      });
      continue;
    }

    pending.push({
      draftId: row.draft_id,
      txHash: row.tx_hash,
      reason:
        "transaction was submitted but no challenge projection exists yet; inspect indexing before releasing the reservation",
    });
    continue;
  }

  await releaseAuthoringSponsorBudgetReservation(db, {
    draftId: row.draft_id,
  });
  released.push({
    draftId: row.draft_id,
    reason: "stale_unsubmitted_publish",
  });
}

console.log(
  JSON.stringify(
    {
      staleMinutes: parsedArgs.staleMinutes,
      draftId: parsedArgs.draftId,
      scanned: rows.length,
      consumed,
      released,
      pending,
    },
    null,
    2,
  ),
);
