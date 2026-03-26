import type { AuthoringSessionCreatorOutput } from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";

export interface ApiEnv {
  Variables: {
    sessionAddress: `0x${string}`;
    agentId: string;
    authoringPrincipal: AuthoringSessionCreatorOutput;
    requestId: string;
    traceId: string;
    logger: AgoraLogger;
  };
}
