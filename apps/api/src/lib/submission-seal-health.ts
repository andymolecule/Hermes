import {
  getSubmissionSealHealth,
  hasSubmissionSealPublicConfig,
  loadConfig,
} from "@agora/common";

export async function readSubmissionSealHealth() {
  const config = loadConfig();
  const health = await getSubmissionSealHealth({
    keyId: config.AGORA_SUBMISSION_SEAL_KEY_ID,
    publicKeyPem: config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
  });

  if (!hasSubmissionSealPublicConfig(config) || !health.enabled) {
    return {
      ...health,
      selfCheck: "disabled" as const,
    };
  }

  return {
    ...health,
    selfCheck: "ok" as const,
  };
}
