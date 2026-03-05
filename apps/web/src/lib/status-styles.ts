import { CHALLENGE_STATUS, type ChallengeStatus } from "@hermes/common";

export type StatusStyle = { bg: string; text: string; borderColor: string };

export const DEFAULT_STATUS_STYLE: StatusStyle = {
  bg: "#e8efe8",
  text: "#2d6a2e",
  borderColor: "#b5cdb6",
};

export const STATUS_STYLES: Record<ChallengeStatus | "judging", StatusStyle> = {
  [CHALLENGE_STATUS.active]: DEFAULT_STATUS_STYLE,
  [CHALLENGE_STATUS.scoring]: { bg: "var(--color-warning-bg)", text: "var(--color-warning)", borderColor: "#FDE68A" },
  judging: { bg: "var(--color-warning-bg)", text: "var(--color-warning)", borderColor: "#FDE68A" },
  [CHALLENGE_STATUS.finalized]: { bg: "var(--color-cobalt-100)", text: "var(--color-cobalt-500)", borderColor: "var(--color-cobalt-200)" },
  [CHALLENGE_STATUS.disputed]: { bg: "var(--color-error-bg)", text: "var(--color-error)", borderColor: "#FECACA" },
  [CHALLENGE_STATUS.cancelled]: { bg: "var(--surface-inset)", text: "var(--text-tertiary)", borderColor: "var(--border-default)" },
};

export function getStatusStyle(status: string | undefined): StatusStyle {
  const normalized = (status ?? CHALLENGE_STATUS.active).toLowerCase();
  return STATUS_STYLES[normalized as ChallengeStatus | "judging"] ?? DEFAULT_STATUS_STYLE;
}
