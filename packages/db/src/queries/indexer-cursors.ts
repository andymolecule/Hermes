import type { HermesDbClient } from "../index";

export async function getIndexerCursor(
  db: HermesDbClient,
  cursorKey: string,
): Promise<bigint | null> {
  const { data, error } = await db
    .from("indexer_cursors")
    .select("block_number")
    .eq("cursor_key", cursorKey)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read indexer cursor: ${error.message}`);
  }
  if (!data?.block_number) return null;
  return BigInt(String(data.block_number));
}

export async function setIndexerCursor(
  db: HermesDbClient,
  cursorKey: string,
  blockNumber: bigint,
) {
  const { error } = await db.from("indexer_cursors").upsert(
    {
      cursor_key: cursorKey,
      block_number: blockNumber.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cursor_key" },
  );

  if (error) {
    throw new Error(`Failed to persist indexer cursor: ${error.message}`);
  }
}
