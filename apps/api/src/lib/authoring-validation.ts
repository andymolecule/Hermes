import type { AuthoringSessionBlockingLayerOutput } from "@agora/common";

export function classifyAuthoringBlockingLayer(
  code: string,
): AuthoringSessionBlockingLayerOutput {
  if (code.startsWith("AUTHORING_DRY_RUN_")) {
    return "dry_run";
  }
  if (code === "AUTHORING_PLATFORM_UNAVAILABLE") {
    return "platform";
  }
  return "input";
}
