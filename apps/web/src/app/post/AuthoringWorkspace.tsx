"use client";

import type { AuthoringSessionOutput } from "@agora/common";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  RefreshCcw,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef } from "react";
import type {
  AuthoringFormState,
  UploadedArtifactDraft,
} from "./authoring-session-form";
import { PostNotice } from "./PostSections";

interface AvailableArtifact {
  artifact_id: string;
  file_name: string;
  role: string | null;
  detected_columns?: string[];
}

interface AuthoringWorkspaceProps {
  form: AuthoringFormState;
  session: AuthoringSessionOutput | null;
  sessionId: string;
  uploads: UploadedArtifactDraft[];
  artifactOptions: AvailableArtifact[];
  isLoadingSession: boolean;
  isSubmitting: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  onFieldChange: <Key extends keyof AuthoringFormState>(
    field: Key,
    value: AuthoringFormState[Key],
  ) => void;
  onValidate: () => void;
  onRefresh: () => void;
  onFilesSelected: (files: FileList) => void;
  onRemoveUpload: (localId: string) => void;
  onOpenReview: () => void;
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
        {label}
      </div>
      {children}
      {hint ? <div className="text-xs text-warm-500">{hint}</div> : null}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-[2px] border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="min-h-[120px] w-full rounded-[2px] border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
    />
  );
}

function SelectInput(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select
      {...props}
      className="w-full rounded-[2px] border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
    />
  );
}

function ValidationSection({
  title,
  tone,
  issues,
}: {
  title: string;
  tone: "warning" | "error";
  issues: NonNullable<AuthoringSessionOutput["validation"]["missing_fields"]>;
}) {
  if (issues.length === 0) {
    return null;
  }

  const toneClass =
    tone === "error"
      ? "border-red-300 bg-red-50 text-red-800"
      : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-[2px] border px-4 py-3 ${toneClass}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-3 space-y-3 text-sm">
        {issues.map((issue) => (
          <div key={`${issue.field}:${issue.code}`} className="space-y-1">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest">
              {issue.field}
            </div>
            <div>{issue.message}</div>
            <div className="text-xs">{issue.next_action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidationPanel({
  session,
  onOpenReview,
}: {
  session: AuthoringSessionOutput | null;
  onOpenReview: () => void;
}) {
  if (!session) {
    return null;
  }

  const { validation } = session;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
            Validation state
          </div>
          <div className="mt-1 text-sm text-warm-700">
            Session <span className="font-mono text-xs text-warm-900">{session.id}</span>
          </div>
        </div>
        <span className="rounded-[2px] border border-warm-300 bg-warm-50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-700">
          {session.state.replace("_", " ")}
        </span>
      </div>

      {session.state === "ready" ? (
        <PostNotice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Agora validated the execution contract and the dry-run passed.
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenReview}
              className="inline-flex items-center gap-2 rounded-[2px] border border-emerald-400 bg-white px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-800 transition hover:border-emerald-700 hover:text-emerald-900 motion-reduce:transition-none"
            >
              Review & Publish
            </button>
          </div>
        </PostNotice>
      ) : null}

      <ValidationSection
        title="Missing fields"
        tone="warning"
        issues={validation.missing_fields}
      />
      <ValidationSection
        title="Invalid fields"
        tone="error"
        issues={validation.invalid_fields}
      />

      {validation.dry_run_failure ? (
        <div className="rounded-[2px] border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          <div className="font-semibold">Dry-run failure</div>
          <div className="mt-2 text-sm">{validation.dry_run_failure.message}</div>
          <div className="mt-1 text-xs">{validation.dry_run_failure.next_action}</div>
        </div>
      ) : null}

      {validation.unsupported_reason ? (
        <div className="rounded-[2px] border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          <div className="font-semibold">Unsupported contract</div>
          <div className="mt-2 text-sm">{validation.unsupported_reason.message}</div>
          <div className="mt-1 text-xs">{validation.unsupported_reason.next_action}</div>
        </div>
      ) : null}
    </div>
  );
}

function UploadList({
  uploads,
  onRemoveUpload,
}: {
  uploads: UploadedArtifactDraft[];
  onRemoveUpload: (localId: string) => void;
}) {
  if (uploads.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {uploads.map((upload) => (
        <div
          key={upload.local_id}
          className="rounded-[2px] border border-warm-300 bg-warm-50 px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-warm-500" />
              <div className="text-sm font-medium text-warm-900">
                {upload.file_name}
              </div>
              <span className="font-mono text-[10px] text-warm-500">
                {upload.status}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onRemoveUpload(upload.local_id)}
              disabled={upload.synced === true}
              className="text-xs text-warm-500 transition hover:text-warm-900 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            >
              Remove
            </button>
          </div>
          {upload.artifact_id ? (
            <div className="mt-2 font-mono text-[11px] text-warm-700">
              artifact_id: {upload.artifact_id}
            </div>
          ) : null}
          {upload.detected_columns && upload.detected_columns.length > 0 ? (
            <div className="mt-2 text-xs text-warm-600">
              Columns: {upload.detected_columns.join(", ")}
            </div>
          ) : null}
          {upload.error ? (
            <div className="mt-2 text-xs text-red-700">{upload.error}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AuthoringWorkspace({
  form,
  session,
  sessionId,
  uploads,
  artifactOptions,
  isLoadingSession,
  isSubmitting,
  statusMessage,
  errorMessage,
  onFieldChange,
  onValidate,
  onRefresh,
  onFilesSelected,
  onRemoveUpload,
  onOpenReview,
}: AuthoringWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      onFilesSelected(event.target.files);
      event.target.value = "";
    }
  }

  const selectedArtifact = artifactOptions.find(
    (artifact) => artifact.artifact_id === form.evaluation_artifact_id,
  );

  return (
    <div className="space-y-6 rounded-[2px] border border-warm-300 bg-white p-6 shadow-[0_20px_40px_rgba(28,28,24,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
            Deterministic session workspace
          </div>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-warm-900">
            Build the challenge contract directly
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-warm-600">
            Provide the structured problem and scoring contract Agora needs.
            Validation runs directly against the session compiler and scorer dry-run.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessionId ? (
            <span className="rounded-[2px] border border-warm-300 bg-warm-50 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-700">
              Session {sessionId.slice(0, 8)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoadingSession || !sessionId}
            className="inline-flex items-center gap-2 rounded-[2px] border border-warm-300 bg-white px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-warm-700 transition hover:border-warm-900 hover:text-warm-900 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          >
            {isLoadingSession ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {statusMessage ? <PostNotice tone="info">{statusMessage}</PostNotice> : null}
      {errorMessage ? <PostNotice tone="error">{errorMessage}</PostNotice> : null}

      <ValidationPanel session={session} onOpenReview={onOpenReview} />

      <section className="space-y-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
          Intent contract
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Title">
            <TextInput
              value={form.title}
              onChange={(event) => onFieldChange("title", event.target.value)}
              placeholder="MDM2 benchmark challenge"
            />
          </FieldShell>
          <FieldShell label="Domain">
            <TextInput
              value={form.domain}
              onChange={(event) => onFieldChange("domain", event.target.value)}
              placeholder="drug_discovery"
            />
          </FieldShell>
        </div>
        <FieldShell label="Description">
          <TextArea
            value={form.description}
            onChange={(event) =>
              onFieldChange("description", event.target.value)
            }
            placeholder="Describe the scientific task, public context, and what solvers are expected to produce."
          />
        </FieldShell>
        <FieldShell
          label="Deterministic winner rule"
          hint="Use the exact metric-style rule, for example: Highest Spearman wins."
        >
          <TextArea
            value={form.payout_condition}
            onChange={(event) =>
              onFieldChange("payout_condition", event.target.value)
            }
            placeholder="Highest Spearman wins."
          />
        </FieldShell>
        <div className="grid gap-4 md:grid-cols-3">
          <FieldShell label="Reward total">
            <TextInput
              value={form.reward_total}
              onChange={(event) =>
                onFieldChange("reward_total", event.target.value)
              }
              placeholder="10"
            />
          </FieldShell>
          <FieldShell label="Distribution">
            <SelectInput
              value={form.distribution}
              onChange={(event) =>
                onFieldChange(
                  "distribution",
                  event.target.value as AuthoringFormState["distribution"],
                )
              }
            >
              <option value="winner_take_all">Winner take all</option>
              <option value="top_3">Top 3</option>
              <option value="proportional">Proportional</option>
            </SelectInput>
          </FieldShell>
          <FieldShell label="Deadline">
            <TextInput
              type="datetime-local"
              value={form.deadline}
              onChange={(event) => onFieldChange("deadline", event.target.value)}
            />
          </FieldShell>
        </div>
      </section>

      <section className="space-y-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
          Scoring contract
        </div>
        <div className="rounded-[2px] border border-warm-300 bg-warm-50 px-4 py-3 text-sm text-warm-700">
          Template is fixed to <span className="font-mono">official_table_metric_v1</span>.
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Metric">
            <TextInput
              value={form.metric}
              onChange={(event) => onFieldChange("metric", event.target.value)}
              placeholder="spearman"
            />
          </FieldShell>
          <FieldShell
            label="Hidden evaluation artifact"
            hint="Choose the uploaded file Agora should treat as the private answer key."
          >
            <SelectInput
              value={form.evaluation_artifact_id}
              onChange={(event) =>
                onFieldChange("evaluation_artifact_id", event.target.value)
              }
            >
              <option value="">Select artifact</option>
              {artifactOptions.map((artifact) => (
                <option key={artifact.artifact_id} value={artifact.artifact_id}>
                  {artifact.file_name} · {artifact.artifact_id.slice(0, 8)}
                </option>
              ))}
            </SelectInput>
          </FieldShell>
        </div>
        {selectedArtifact?.detected_columns?.length ? (
          <div className="rounded-[2px] border border-warm-300 bg-warm-50 px-4 py-3 text-xs text-warm-700">
            Detected columns: {selectedArtifact.detected_columns.join(", ")}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Evaluation ID column">
            <TextInput
              value={form.evaluation_id_column}
              onChange={(event) =>
                onFieldChange("evaluation_id_column", event.target.value)
              }
              placeholder="peptide_id"
            />
          </FieldShell>
          <FieldShell label="Evaluation value column">
            <TextInput
              value={form.evaluation_value_column}
              onChange={(event) =>
                onFieldChange("evaluation_value_column", event.target.value)
              }
              placeholder="reference_rank"
            />
          </FieldShell>
          <FieldShell label="Submission ID column">
            <TextInput
              value={form.submission_id_column}
              onChange={(event) =>
                onFieldChange("submission_id_column", event.target.value)
              }
              placeholder="peptide_id"
            />
          </FieldShell>
          <FieldShell label="Submission value column">
            <TextInput
              value={form.submission_value_column}
              onChange={(event) =>
                onFieldChange("submission_value_column", event.target.value)
              }
              placeholder="predicted_score"
            />
          </FieldShell>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
              Uploaded artifacts
            </div>
            <div className="mt-1 text-sm text-warm-600">
              Upload files first, then bind the hidden evaluation artifact above.
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-[2px] border border-warm-300 bg-white px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-warm-700 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Upload files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <UploadList uploads={uploads} onRemoveUpload={onRemoveUpload} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-warm-200 pt-4">
        <div className="flex items-start gap-2 text-sm text-warm-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warm-500" />
          <div>
            Agora validates exact fields only. It will not brainstorm or infer hidden requirements on this path.
          </div>
        </div>
        <button
          type="button"
          onClick={onValidate}
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-[2px] border-2 border-warm-900 bg-warm-900 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white shadow-[3px_3px_0px_var(--color-warm-900)] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_var(--color-warm-900)] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none"
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Validate session
        </button>
      </div>
    </div>
  );
}
