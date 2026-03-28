import { getAgoraReleaseMetadata } from "@agora/common";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const release = getAgoraReleaseMetadata();
  return NextResponse.json(
    {
      ok: true,
      service: "web",
      releaseId: release.releaseId,
      gitSha: release.gitSha,
      runtimeVersion: release.runtimeVersion,
      identitySource: release.identitySource,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
