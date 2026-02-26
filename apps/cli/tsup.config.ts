import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true,
  treeshake: true,
  // Only inline workspace packages (resolves JSON imports + extensionless re-exports).
  // All npm packages stay external and are resolved from node_modules at runtime.
  noExternal: [
    "@hermes/common",
    "@hermes/chain",
    "@hermes/db",
    "@hermes/ipfs",
    "@hermes/scorer",
  ],
});
