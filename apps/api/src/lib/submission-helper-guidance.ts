import {
  SUBMISSION_HELPER_MODE,
  SUBMISSION_HELPER_WORKFLOW_VERSION,
} from "@agora/common";

export function buildSubmissionHelperGuidance() {
  return {
    mode: SUBMISSION_HELPER_MODE,
    workflow_version: SUBMISSION_HELPER_WORKFLOW_VERSION,
    prepare_command:
      "agora prepare-submission ./submission.csv --challenge <challenge_uuid> --key env:AGORA_PRIVATE_KEY --format json",
    submit_command:
      "agora submit ./submission.csv --challenge <challenge_uuid> --key env:AGORA_PRIVATE_KEY --format json",
    note: "Autonomous agents should call the official local helper instead of implementing submission transport or submission crypto directly. Raw HTTP submission routes and custom sealers are advanced interop only.",
  };
}
