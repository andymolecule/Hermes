import type { HermesDbClient } from "../index";

export async function isEventIndexed(
  db: HermesDbClient,
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
  db: HermesDbClient,
  txHash: string,
  logIndex: number,
  eventName: string,
  blockNumber: number,
) {
  const { error } = await db.from("indexed_events").insert({
    tx_hash: txHash,
    log_index: logIndex,
    event_name: eventName,
    block_number: blockNumber,
  });
  if (error) {
    throw new Error(`Failed to insert indexed event: ${error.message}`);
  }
}
