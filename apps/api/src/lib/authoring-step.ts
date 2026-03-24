import type {
  AuthoringSessionBlockingLayerOutput,
  AuthoringValidationFieldOutput,
} from "@agora/common";

export type AuthoringStepFailureKind =
  | "awaiting_input"
  | "rejected"
  | "platform_error";

export interface AuthoringStepFailure {
  kind: AuthoringStepFailureKind;
  code: string;
  message: string;
  nextAction: string;
  blockingLayer: AuthoringSessionBlockingLayerOutput;
  field: string;
  missingFields: AuthoringValidationFieldOutput[];
  candidateValues: string[];
  reasonCodes: string[];
  warnings: string[];
}

export type AuthoringStepResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      failure: AuthoringStepFailure;
    };

export function stepOk<T>(value: T): AuthoringStepResult<T> {
  return {
    ok: true,
    value,
  };
}

export function stepFailure<T = never>(
  failure: AuthoringStepFailure,
): AuthoringStepResult<T> {
  return {
    ok: false,
    failure,
  };
}
