import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  agoraClientTelemetrySchema,
  type AgoraClientTelemetryOutput,
} from "@agora/common";

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
