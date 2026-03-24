import type {
  ExternalSourceProviderOutput,
  TrustedChallengeSpecOutput,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";

export interface AuthoringSessionSourceAttribution {
  provider: Exclude<ExternalSourceProviderOutput, "direct">;
  externalId: string | null;
  externalUrl: string | null;
  agentHandle: string | null;
}

function firstStringValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function getAuthoringSessionSourceAttribution(
  session: Pick<AuthoringSessionRow, "authoring_ir_json">,
): AuthoringSessionSourceAttribution | null {
  const origin = session.authoring_ir_json?.origin;
  if (!origin || origin.provider === "direct") {
    return null;
  }

  const rawContext = origin.raw_context ?? null;
  return {
    provider: origin.provider,
    externalId: origin.external_id ?? null,
    externalUrl: origin.external_url ?? null,
    agentHandle: firstStringValue(rawContext, [
      "source_agent_handle",
      "agent_handle",
      "poster_agent_handle",
      "beach_poster_agent_handle",
    ]),
  };
}

export function withAuthoringSessionSourceAttribution(
  spec: TrustedChallengeSpecOutput,
  attribution: AuthoringSessionSourceAttribution | null,
): TrustedChallengeSpecOutput {
  if (!attribution) {
    return spec;
  }

  return {
    ...spec,
    source: {
      provider: attribution.provider,
      external_id: attribution.externalId,
      external_url: attribution.externalUrl,
      agent_handle: attribution.agentHandle,
    },
  };
}
