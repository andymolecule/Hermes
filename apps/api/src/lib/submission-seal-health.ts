import {
  getSubmissionSealHealth,
  loadConfig,
  runSubmissionSealSelfCheck,
} from "@hermes/common";

export async function readSubmissionSealHealth() {
  const config = loadConfig();
  const health = await getSubmissionSealHealth({
    keyId: config.HERMES_SUBMISSION_SEAL_KEY_ID,
    publicKeyPem: config.HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    privateKeyPem: config.HERMES_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  });

  if (!health.enabled) {
    return {
      ...health,
      selfCheck: "disabled" as const,
    };
  }

  try {
    await runSubmissionSealSelfCheck({
      keyId: config.HERMES_SUBMISSION_SEAL_KEY_ID as string,
      publicKeyPem: config.HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM as string,
      privateKeyPem: config.HERMES_SUBMISSION_OPEN_PRIVATE_KEY_PEM as string,
    });
    return {
      ...health,
      selfCheck: "ok" as const,
    };
  } catch (error) {
    return {
      ...health,
      selfCheck: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
