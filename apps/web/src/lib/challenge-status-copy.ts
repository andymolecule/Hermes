import { CHALLENGE_STATUS, type ChallengeStatus } from "@agora/common";
import { deadlineCountdown } from "./format";

type TimelineStep = {
  key: ChallengeStatus;
  label: string;
  title: string;
  detail: string;
};

const BASE_TIMELINE_STEPS: Record<ChallengeStatus, TimelineStep> = {
  [CHALLENGE_STATUS.open]: {
    key: CHALLENGE_STATUS.open,
    label: "Open",
    title: "Submission Phase",
    detail:
      "Accepting solver submissions. Initial vetting and verification in progress.",
  },
  [CHALLENGE_STATUS.scoring]: {
    key: CHALLENGE_STATUS.scoring,
    label: "Closed",
    title: "Review & Scoring",
    detail:
      "Submission window closed; scoring and review continue before settlement.",
  },
  [CHALLENGE_STATUS.disputed]: {
    key: CHALLENGE_STATUS.disputed,
    label: "Disputed",
    title: "Dispute Review",
    detail: "Scores under dispute or review.",
  },
  [CHALLENGE_STATUS.finalized]: {
    key: CHALLENGE_STATUS.finalized,
    label: "Finalized",
    title: "Payout Distribution",
    detail:
      "Scoring complete; payouts claimable by verified contributors.",
  },
  [CHALLENGE_STATUS.cancelled]: {
    key: CHALLENGE_STATUS.cancelled,
    label: "Cancelled",
    title: "Challenge Cancelled",
    detail: "Challenge cancelled and reward refunded.",
  },
};

export function getChallengeBadgeLabel(status: ChallengeStatus): string {
  return (
    {
      [CHALLENGE_STATUS.open]: "Live",
      [CHALLENGE_STATUS.scoring]: "Closed",
      [CHALLENGE_STATUS.disputed]: "Disputed",
      [CHALLENGE_STATUS.finalized]: "Settled",
      [CHALLENGE_STATUS.cancelled]: "Cancelled",
    }[status] ?? status
  );
}

export function getChallengeCardFooterLabel({
  status,
  deadline,
}: {
  status: ChallengeStatus;
  deadline: string;
}): string {
  switch (status) {
    case CHALLENGE_STATUS.open:
      return deadlineCountdown(deadline);
    case CHALLENGE_STATUS.scoring:
      return "Submissions closed";
    case CHALLENGE_STATUS.disputed:
      return "Dispute in review";
    case CHALLENGE_STATUS.finalized:
      return "Settled on-chain";
    case CHALLENGE_STATUS.cancelled:
      return "Challenge cancelled";
    default:
      return deadlineCountdown(deadline);
  }
}

export function getChallengeTimelineFlow(
  status: ChallengeStatus,
): TimelineStep[] {
  if (status === CHALLENGE_STATUS.cancelled) {
    return [
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.open],
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.cancelled],
    ];
  }

  if (status === CHALLENGE_STATUS.disputed) {
    return [
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.open],
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.scoring],
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.disputed],
      BASE_TIMELINE_STEPS[CHALLENGE_STATUS.finalized],
    ];
  }

  return [
    BASE_TIMELINE_STEPS[CHALLENGE_STATUS.open],
    BASE_TIMELINE_STEPS[CHALLENGE_STATUS.scoring],
    BASE_TIMELINE_STEPS[CHALLENGE_STATUS.finalized],
  ];
}
