"use client";

import type {
  AuthoringQuestionOutput,
  AuthoringSessionQuestionOutput,
} from "@agora/common";

type RenderableQuestion =
  | AuthoringQuestionOutput
  | AuthoringSessionQuestionOutput;

function isLegacyQuestion(
  question: RenderableQuestion,
): question is AuthoringQuestionOutput {
  return "prompt" in question;
}

function fieldHint(question: RenderableQuestion) {
  if (!isLegacyQuestion(question)) {
    switch (question.kind) {
      case "select":
        return question.options.length > 0
          ? "Choose one of the supported options below."
          : null;
      case "file":
        return "Attach or reference the file Agora should use.";
      default:
        return "Answer in one concrete sentence.";
    }
  }

  switch (question.kind) {
    case "currency_amount":
      return "Answer with a total USDC amount.";
    case "single_select":
      return question.options.length > 0
        ? "Choose one of the supported options below."
        : null;
    case "artifact_select":
      return "Attach or reference the file Agora should use.";
    default:
      return "Answer in one concrete sentence.";
  }
}

export function AuthoringQuestionList({
  questions,
  tone = "amber",
}: {
  questions: RenderableQuestion[];
  tone?: "amber" | "warm";
}) {
  if (questions.length === 0) {
    return null;
  }

  const containerClass =
    tone === "warm"
      ? "border-warm-300 bg-warm-50 text-warm-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  const hintClass = tone === "warm" ? "text-warm-700" : "text-amber-800";
  const optionClass =
    tone === "warm"
      ? "border-warm-200 bg-white text-warm-800"
      : "border-amber-200 bg-white text-amber-900";

  return (
    <div className={`rounded-[2px] border px-4 py-3 text-sm ${containerClass}`}>
      <div className="font-semibold">
        Agora still needs these blocking inputs.
      </div>
      <div className="mt-3 space-y-3">
        {questions.map((question) => {
          const hint = fieldHint(question);
          const title = isLegacyQuestion(question) ? question.prompt : question.text;
          const reason = isLegacyQuestion(question)
            ? question.why
            : question.reason;
          const selectOptions = isLegacyQuestion(question)
            ? question.options.map((option) => ({
                id: option.id,
                label: option.label,
              }))
            : question.kind === "select"
              ? question.options.map((option: string) => ({
                  id: option,
                  label: option,
                }))
              : [];
          return (
            <div key={question.id} className="space-y-1.5">
              <div className="font-medium">{title}</div>
              {reason ? (
                <div className={hintClass}>{reason}</div>
              ) : null}
              {hint ? (
                <div className={`text-xs ${hintClass}`}>{hint}</div>
              ) : null}

              {selectOptions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectOptions.map((option) => (
                    <span
                      key={option.id}
                      className={`rounded-[2px] border px-2 py-1 font-mono text-[11px] ${optionClass}`}
                    >
                      {option.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {isLegacyQuestion(question) &&
              question.kind === "artifact_select" &&
              question.artifact_options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {question.artifact_options.map((artifact) => (
                    <span
                      key={artifact.id}
                      className={`rounded-[2px] border px-2 py-1 font-mono text-[11px] ${optionClass}`}
                    >
                      {artifact.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
