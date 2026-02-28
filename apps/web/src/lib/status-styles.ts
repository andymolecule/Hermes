export type StatusStyle = { bg: string; text: string; borderColor: string };

export const DEFAULT_STATUS_STYLE: StatusStyle = {
  bg: "var(--color-success-bg)",
  text: "var(--color-success)",
  borderColor: "#BBF7D0",
};

export const STATUS_STYLES: Record<string, StatusStyle> = {
  active: DEFAULT_STATUS_STYLE,
  scoring: { bg: "var(--color-warning-bg)", text: "var(--color-warning)", borderColor: "#FDE68A" },
  judging: { bg: "var(--color-warning-bg)", text: "var(--color-warning)", borderColor: "#FDE68A" },
  finalized: { bg: "var(--color-cobalt-100)", text: "var(--color-cobalt-500)", borderColor: "var(--color-cobalt-200)" },
  disputed: { bg: "var(--color-error-bg)", text: "var(--color-error)", borderColor: "#FECACA" },
  cancelled: { bg: "var(--surface-inset)", text: "var(--text-tertiary)", borderColor: "var(--border-default)" },
};

export function getStatusStyle(status: string | undefined): StatusStyle {
  return STATUS_STYLES[(status ?? "active").toLowerCase()] ?? DEFAULT_STATUS_STYLE;
}
