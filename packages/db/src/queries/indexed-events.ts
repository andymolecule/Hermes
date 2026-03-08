import type { AgoraDbClient } from "../index";

export async function isEventIndexed(
  db: AgoraDbClient,
  txHash: string,
  logIndex: number,
): Promise<boolean> {
  const { data, error } = await db
    .from("indexed_events")
    .select("tx_hash")
    .eq("tx_hash", txHash)
    .eq("log_index", logIndex)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to query indexed events: ${error.message}`);
  }
  return Boolean(data);
}

export async function markEventIndexed(
  db: AgoraDbClient,
  txHash: string,
  logIndex: number,
  eventName: string,
  blockNumber: number,
  blockHash?: string | null,
) {
  const { error } = await db.from("indexed_events").upsert(
    {
      tx_hash: txHash,
      log_index: logIndex,
      event_name: eventName,
      block_number: blockNumber,
      block_hash: blockHash ?? null,
    },
    { onConflict: "tx_hash,log_index" },
  );
  if (error) {
    throw new Error(`Failed to upsert indexed event: ${error.message}`);
  }
}
