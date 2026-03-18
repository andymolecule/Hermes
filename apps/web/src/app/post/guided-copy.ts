"use client";

import type { clarificationTargetFromQuestions } from "./guided-state";

export function clarificationHelperText(
  target: ReturnType<typeof clarificationTargetFromQuestions>,
) {
  switch (target) {
    case "winningCondition":
      return "Update the winning condition, then reconfirm the later answers below it.";
    case "uploads":
      return "Review the uploaded files, rename any ambiguous aliases, and make sure the problem statement still matches them.";
    case "problem":
      return "Tighten the problem statement so Agora can map the files and scoring rules safely.";
  }
}
