export * from "./client";
export * from "./factory";
export * from "./challenge";
export * from "./usdc";
// Note: indexer is NOT exported here — it has auto-start behavior
// and should be run directly: node --import tsx packages/chain/src/indexer.ts
