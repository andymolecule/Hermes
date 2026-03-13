const QUICK_TEST_BUFFER_MINUTES = 2;

const QUICK_TEST_WINDOWS: Record<string, number> = {
  "15m": 15,
  "0": 30,
};

function getQuickTestMinutes(windowValue: string) {
  return QUICK_TEST_WINDOWS[windowValue] ?? null;
}

export function formatSubmissionWindowLabel(windowValue: string): string {
  const quickTestMinutes = getQuickTestMinutes(windowValue);
  if (quickTestMinutes !== null) {
    return `${quickTestMinutes} min`;
  }

  return `${windowValue} days`;
}

/** Compute a fresh deadline ISO from a submission-window selection. */
export function computeDeadlineIso(windowValue: string): string {
  const quickTestMinutes = getQuickTestMinutes(windowValue);
  if (quickTestMinutes !== null) {
    return new Date(
      Date.now() + (quickTestMinutes + QUICK_TEST_BUFFER_MINUTES) * 60 * 1000,
    ).toISOString();
  }

  return new Date(
    Date.now() + Number(windowValue) * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Format a deadline date for display. */
export function formatDeadlineDate(windowValue: string): string {
  return new Date(computeDeadlineIso(windowValue)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format the earliest deterministic point where review can end. */
export function formatFinalizationCheckDate(
  windowValue: string,
  disputeWindowHours: string,
): string {
  const deadlineMs = new Date(computeDeadlineIso(windowValue)).getTime();
  const earliestFinalizeCheckMs =
    deadlineMs + Number(disputeWindowHours) * 3600000;
  return new Date(earliestFinalizeCheckMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
