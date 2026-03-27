import type { AuthoringAgentPrincipalOutput } from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";

export interface ApiEnv {
  Variables: {
    sessionAddress: `0x${string}`;
    agentId: string;
    authoringPrincipal: AuthoringAgentPrincipalOutput;
    requestId: string;
    traceId: string;
    logger: AgoraLogger;
  };
}
