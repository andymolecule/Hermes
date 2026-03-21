"use client";

import type { AuthoringQuestionOutput } from "@agora/common";

function fieldHint(question: AuthoringQuestionOutput) {
  switch (question.kind) {
    case "currency_amount":
      return "Answer with a total USDC amount.";
    case "single_select":
      return question.options.length > 0
        ? "Choose one of the supported options below."
        : null;
    case "artifact_role_map":
      return "Map each required scorer role to one uploaded file.";
    default:
      return "Answer in one concrete sentence.";
  }
}

export function AuthoringQuestionList({
  questions,
  tone = "amber",
}: {
  questions: AuthoringQuestionOutput[];
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
        {questions.map((question) => (
          <div key={question.id} className="space-y-1.5">
            <div className="font-medium">{question.prompt}</div>
            {question.why ? (
              <div className={hintClass}>{question.why}</div>
            ) : null}
            {fieldHint(question) ? (
              <div className={`text-xs ${hintClass}`}>
                {fieldHint(question)}
              </div>
            ) : null}

            {question.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {question.options.map((option) => (
                  <span
                    key={option.id}
                    className={`rounded-[2px] border px-2 py-1 font-mono text-[11px] ${optionClass}`}
                  >
                    {option.label}
                  </span>
                ))}
              </div>
            ) : null}

            {question.kind === "artifact_role_map" &&
            question.artifact_roles.length > 0 ? (
              <div className="space-y-1 pt-1 text-xs">
                {question.artifact_roles.map((role) => (
                  <div key={role.role} className={hintClass}>
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                      {role.label}
                    </span>
                    {role.visibility
                      ? ` · ${role.visibility} during scoring`
                      : ""}
                  </div>
                ))}
              </div>
            ) : null}

            {question.kind === "artifact_role_map" &&
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
        ))}
      </div>
    </div>
  );
}
