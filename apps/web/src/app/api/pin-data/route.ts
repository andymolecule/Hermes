import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pinFile } from "@hermes/ipfs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

function hasValidOrigin(req: Request) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (!origin || !host) return false;
    try {
        const parsed = new URL(origin);
        return parsed.host === host;
    } catch {
        return false;
    }
}

function getRateLimitKey(req: Request) {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || "unknown";
}

function isRateLimited(key: string) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    bucket.count += 1;
    return bucket.count > RATE_LIMIT_MAX;
}

export async function POST(req: Request) {
    let tempDir: string | null = null;
    let tempFilePath: string | null = null;
    try {
        if (!hasValidOrigin(req)) {
            return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
        }
        if (isRateLimited(getRateLimitKey(req))) {
            return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        if (!file) {
            return NextResponse.json({ error: "No file provided." }, { status: 400 });
        }
        if (file.size > MAX_FILE_BYTES) {
            return NextResponse.json({ error: `File too large. Max ${MAX_FILE_BYTES / 1024 / 1024}MB.` }, { status: 413 });
        }

        // Store upload temporarily and stream-pin it as a file (no base64 wrapping).
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-upload-"));
        const safeName = path.basename(file.name || "upload.bin");
        tempFilePath = path.join(tempDir, `${randomUUID()}-${safeName}`);
        const buffer = await file.arrayBuffer();
        await fs.writeFile(tempFilePath, Buffer.from(buffer));

        const cid = await pinFile(tempFilePath, safeName);
        return NextResponse.json({ cid });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Upload failed." },
            { status: 500 },
        );
    } finally {
        if (tempFilePath) {
            await fs.rm(tempFilePath, { force: true });
        }
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
}
