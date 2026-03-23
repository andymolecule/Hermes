"use client";

import type { AuthoringSessionOutput } from "@agora/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySessionToForm,
  buildExecutionPatch,
  buildIntentPatch,
  createEmptyAuthoringFormState,
  type AuthoringFormState,
  type UploadedArtifactDraft,
} from "./authoring-session-form";
import {
  createAuthoringSession,
  getAuthoringSession,
  getAuthoringSessionRequestStatus,
  patchAuthoringSession,
  uploadAuthoringSessionFile,
} from "./post-authoring-api";

interface UseAuthoringSessionOptions {
  hostedSessionId?: string | null;
  onCompileReady?: (session: AuthoringSessionOutput) => void;
}

interface AvailableArtifact {
  artifact_id: string;
  file_name: string;
  role: string | null;
  detected_columns?: string[];
}

function isCsvLikeFile(file: File) {
  return (
    file.name.trim().toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv"
  );
}

function splitCsvHeaderRow(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (quoted && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells.filter((cell) => cell.length > 0);
}

async function detectCsvColumnsFromFile(file: File) {
  if (!isCsvLikeFile(file)) {
    return undefined;
  }

  const text = await file.slice(0, 64 * 1024).text();
  const firstLine = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  const columns = splitCsvHeaderRow(firstLine);
  return columns.length > 0 ? columns : undefined;
}

function nextUploadId(fileName: string) {
  return `upload-${Date.now()}-${fileName}`;
}

function isTerminalSessionState(state: AuthoringSessionOutput["state"] | null) {
  return (
    state === "ready" ||
    state === "published" ||
    state === "rejected" ||
    state === "expired"
  );
}

function buildArtifactOptions(input: {
  session: AuthoringSessionOutput | null;
  uploads: UploadedArtifactDraft[];
}) {
  const options = new Map<string, AvailableArtifact>();

  for (const artifact of input.session?.artifacts ?? []) {
    options.set(artifact.artifact_id, {
      artifact_id: artifact.artifact_id,
      file_name: artifact.file_name,
      role: artifact.role,
    });
  }

  for (const upload of input.uploads) {
    const artifactId = upload.artifact_id;
    if (!artifactId || upload.status !== "ready") {
      continue;
    }
    options.set(artifactId, {
      artifact_id: artifactId,
      file_name: upload.file_name,
      role: upload.role ?? null,
      detected_columns: upload.detected_columns,
    });
  }

  return Array.from(options.values());
}

export function useAuthoringSession(options: UseAuthoringSessionOptions) {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const [form, setForm] = useState<AuthoringFormState>(() =>
    createEmptyAuthoringFormState(timezone),
  );
  const [session, setSession] = useState<AuthoringSessionOutput | null>(null);
  const [sessionId, setSessionId] = useState(options.hostedSessionId ?? "");
  const [uploads, setUploads] = useState<UploadedArtifactDraft[]>([]);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sentUploadIdsRef = useRef(new Set<string>());

  const artifactOptions = useMemo(
    () =>
      buildArtifactOptions({
        session,
        uploads,
      }),
    [session, uploads],
  );

  const syncSession = useCallback(
    (nextSession: AuthoringSessionOutput) => {
      setSession(nextSession);
      setSessionId(nextSession.id);
      setForm((current) => applySessionToForm(nextSession, current));
      if (nextSession.state === "ready" && nextSession.compilation) {
        options.onCompileReady?.(nextSession);
      }
    },
    [options],
  );

  const refreshSession = useCallback(
    async (idOverride?: string) => {
      const targetId = idOverride ?? sessionId ?? options.hostedSessionId ?? "";
      if (!targetId) {
        return null;
      }

      try {
        setIsLoadingSession(true);
        setErrorMessage(null);
        const nextSession = await getAuthoringSession(targetId);
        syncSession(nextSession);
        return nextSession;
      } catch (error) {
        const status = getAuthoringSessionRequestStatus(error);
        if (status === 404) {
          setSession(null);
          setSessionId("");
        }
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to refresh session.",
        );
        return null;
      } finally {
        setIsLoadingSession(false);
      }
    },
    [options.hostedSessionId, sessionId, syncSession],
  );

  useEffect(() => {
    if (options.hostedSessionId) {
      void refreshSession(options.hostedSessionId);
    }
  }, [options.hostedSessionId, refreshSession]);

  const updateField = useCallback(
    <Key extends keyof AuthoringFormState>(field: Key, value: AuthoringFormState[Key]) => {
      setForm((current) => {
        const next = {
          ...current,
          [field]: value,
        };

        if (
          field === "evaluation_id_column" &&
          current.submission_id_column.trim().length === 0
        ) {
          next.submission_id_column = String(value);
        }

        return next;
      });
    },
    [],
  );

  const uploadFiles = useCallback(async (files: FileList) => {
    const uploadEntries = await Promise.all(
      Array.from(files).map(async (file) => ({
        file,
        upload: {
          local_id: nextUploadId(file.name),
          artifact_id: undefined,
          file_name: file.name,
          mime_type: file.type || undefined,
          size_bytes: file.size,
          status: "uploading" as const,
          detected_columns: await detectCsvColumnsFromFile(file),
        },
      })),
    );
    const nextUploads = uploadEntries.map((entry) => entry.upload);

    setUploads((current) => [...current, ...nextUploads]);

    for (const entry of uploadEntries) {
      try {
        const uploaded = await uploadAuthoringSessionFile(entry.file);
        setUploads((current) =>
          current.map((currentUpload) =>
            currentUpload.local_id === entry.upload.local_id
              ? {
                  ...currentUpload,
                  artifact_id: uploaded.artifact_id,
                  uri: uploaded.uri,
                  source_url: uploaded.source_url ?? null,
                  role: uploaded.role ?? null,
                  status: "ready",
                }
              : currentUpload,
          ),
        );
      } catch (error) {
        setUploads((current) =>
          current.map((currentUpload) =>
            currentUpload.local_id === entry.upload.local_id
              ? {
                  ...currentUpload,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                }
              : currentUpload,
          ),
        );
      }
    }
  }, []);

  const removeUpload = useCallback((localId: string) => {
    setUploads((current) =>
      current.filter((upload) => {
        if (upload.local_id !== localId) {
          return true;
        }
        return upload.synced === true;
      }),
    );
  }, []);

  const validateSession = useCallback(async () => {
    const unsyncedFiles = uploads
      .filter(
        (upload) =>
          upload.status === "ready" &&
          upload.artifact_id &&
          !sentUploadIdsRef.current.has(upload.artifact_id),
      )
      .map((upload) => ({
        type: "artifact" as const,
        artifact_id: upload.artifact_id as string,
      }));

    const intent = buildIntentPatch(form);
    const execution = buildExecutionPatch(form);
    const hasStructuredPayload = Boolean(intent || execution || unsyncedFiles.length > 0);
    const mustCreate =
      session == null || sessionId.length === 0 || isTerminalSessionState(session.state);

    if (!hasStructuredPayload) {
      setErrorMessage("Provide at least one structured field or uploaded file.");
      return null;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage(
        mustCreate
          ? "Creating session and validating contract..."
          : "Patching session and re-running validation...",
      );
      setErrorMessage(null);

      const nextSession = mustCreate
        ? await createAuthoringSession({
            ...(intent ? { intent } : {}),
            ...(execution ? { execution } : {}),
            ...(unsyncedFiles.length > 0 ? { files: unsyncedFiles } : {}),
          })
        : await patchAuthoringSession({
            sessionId,
            body: {
              ...(intent ? { intent } : {}),
              ...(execution ? { execution } : {}),
              ...(unsyncedFiles.length > 0 ? { files: unsyncedFiles } : {}),
            },
          });

      syncSession(nextSession);
      for (const file of unsyncedFiles) {
        sentUploadIdsRef.current.add(file.artifact_id);
      }
      setUploads((current) =>
        current.map((upload) =>
          upload.artifact_id && sentUploadIdsRef.current.has(upload.artifact_id)
            ? { ...upload, synced: true }
            : upload,
        ),
      );

      if (nextSession.state === "ready") {
        setStatusMessage("Challenge contract validated. Review before publish.");
      } else if (nextSession.state === "awaiting_input") {
        setStatusMessage("Agora returned deterministic validation blockers.");
      } else if (nextSession.state === "rejected") {
        setStatusMessage("Agora rejected this contract as unsupported.");
      } else {
        setStatusMessage("Session updated.");
      }
      return nextSession;
    } catch (error) {
      const status = getAuthoringSessionRequestStatus(error);
      if (status === 404 || status === 409) {
        setSession(null);
        setSessionId("");
        sentUploadIdsRef.current.clear();
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Validation failed.",
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [form, session, sessionId, syncSession, uploads]);

  return {
    form,
    session,
    sessionId,
    uploads,
    artifactOptions,
    isLoadingSession,
    isSubmitting,
    statusMessage,
    errorMessage,
    setStatusMessage,
    setErrorMessage,
    updateField,
    uploadFiles,
    removeUpload,
    refreshSession,
    validateSession,
    compilation: session?.compilation ?? null,
  };
}
