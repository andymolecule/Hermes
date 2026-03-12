/**
 * Generic scoring workspace utilities.
 * Mount-specific file staging now lives in the pipeline via preset mount config.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WAD_SCALE = 1_000_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function createScoringWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agora-score-"));
    const inputDir = path.join(root, "input");
    await fs.mkdir(inputDir, { recursive: true });
    return { root, inputDir };
}

// ---------------------------------------------------------------------------
// WAD conversion (18-decimal fixed-point used by the contract)
// ---------------------------------------------------------------------------

export function scoreToWad(score: number): bigint {
    if (!Number.isFinite(score) || score < 0) {
        throw new Error(`Invalid score value: ${score}`);
    }
    const normalized = score.toFixed(18);
    const parts = normalized.split(".");
    const whole = parts[0] as string;
    const fractional = parts[1] ?? "";
    const wholePart = BigInt(whole);
    const fractionalPart = BigInt(fractional.padEnd(18, "0").slice(0, 18));
    return wholePart * WAD_SCALE + fractionalPart;
}

export function wadToScore(wad: string | number | bigint): number {
    if (typeof wad === "string" && wad.includes(".")) {
        return Number(wad);
    }
    const value = typeof wad === "bigint" ? wad : BigInt(wad);
    const whole = value / WAD_SCALE;
    const fractional = value % WAD_SCALE;
    const asString = `${whole}.${fractional.toString().padStart(18, "0")}`;
    return Number(asString);
}

// ---------------------------------------------------------------------------
// Workspace cleanup
// ---------------------------------------------------------------------------

export async function cleanupWorkspace(root: string) {
    try {
        await fs.rm(root, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup
    }
}
