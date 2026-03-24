export * from "./client.js";
export * from "./factory.js";
export * from "./challenge.js";
export * from "./challenge-definition.js";
export * from "./contract-read.js";
export * from "./solver-signer.js";
export * from "./tx-preflight.js";
export * from "./tx-write.js";
export * from "./usdc.js";
// Note: indexer is NOT exported here — it has auto-start behavior
// and should be run directly: node --import tsx packages/chain/src/indexer.ts
