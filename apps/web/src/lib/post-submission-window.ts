const QUICK_TEST_BUFFER_MINUTES = 2;
export const MINIMUM_PUBLISHABLE_WINDOW_MS = 5 * 60 * 1000;

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

export function getSubmissionDeadlineWindowState(
  deadlineIso: string,
  nowMs = Date.now(),
  minimumRemainingMs = MINIMUM_PUBLISHABLE_WINDOW_MS,
) {
  const deadlineMs = Date.parse(deadlineIso);
  if (Number.isNaN(deadlineMs)) {
    return "invalid" as const;
  }

  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0) {
    return "expired" as const;
  }
  if (remainingMs < minimumRemainingMs) {
    return "too_close" as const;
  }
  return "ok" as const;
}
