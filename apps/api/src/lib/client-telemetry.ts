import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_REQUIRED_AGENT_WRITE_HEADERS,
  agoraClientTelemetrySchema,
  type AgoraClientTelemetryOutput,
} from "@agora/common";

export interface RequiredAgentTelemetryHeaderIssue {
  header: (typeof AGORA_REQUIRED_AGENT_WRITE_HEADERS)[number];
  reason: "missing" | "invalid";
}

export function readAgoraClientTelemetry(input: {
  header(name: string): string | undefined;
}): AgoraClientTelemetryOutput | null {
  const client = agoraClientTelemetrySchema.parse({
    client_name: input.header(AGORA_CLIENT_NAME_HEADER) ?? null,
    client_version: input.header(AGORA_CLIENT_VERSION_HEADER) ?? null,
    decision_summary: input.header(AGORA_DECISION_SUMMARY_HEADER) ?? null,
  });
  if (
    !client.client_name &&
    !client.client_version &&
    !client.decision_summary
  ) {
    return null;
  }
  return client;
}

export function listRequiredAgentTelemetryHeaderIssues(input: {
  header(name: string): string | undefined;
}): RequiredAgentTelemetryHeaderIssue[] {
  const issues: RequiredAgentTelemetryHeaderIssue[] = [];
  for (const header of AGORA_REQUIRED_AGENT_WRITE_HEADERS) {
    const value = input.header(header);
    if (value === undefined) {
      issues.push({ header, reason: "missing" });
      continue;
    }
    if (value.trim().length === 0) {
      issues.push({ header, reason: "invalid" });
    }
  }
  return issues;
}

export function buildRequiredAgentTelemetryDetails(
  issues: RequiredAgentTelemetryHeaderIssue[],
) {
  return {
    missing_headers: issues
      .filter((issue) => issue.reason === "missing")
      .map((issue) => issue.header),
    invalid_headers: issues
      .filter((issue) => issue.reason === "invalid")
      .map((issue) => issue.header),
  };
}

export function buildRequiredAgentTelemetryNextAction() {
  return "Retry with x-agora-trace-id, x-agora-client-name, and x-agora-client-version headers on every authenticated write request.";
}
