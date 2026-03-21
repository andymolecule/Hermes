import {
  AgoraError,
  type AuthoringArtifactOutput,
  createCsvTableSubmissionContract,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type {
  CompilerArtifactAssignment,
  SupportedRuntimeFamily,
} from "./managed-authoring-compiler.js";

export interface ResolvedManagedArtifacts {
  resolvedArtifacts: Array<
    AuthoringArtifactOutput & {
      role: string;
      visibility: "public" | "private";
    }
  >;
  evaluationBundle?: string;
  submissionContract: ReturnType<typeof createCsvTableSubmissionContract>;
}

function inferIdColumn(artifact?: AuthoringArtifactOutput) {
  const columns = artifact?.detected_columns ?? [];
  const explicitId = columns.find((column: string) => /^id$/i.test(column));
  return explicitId ?? columns[0] ?? "id";
}

function defaultVisibilityForRole(role: string): "public" | "private" {
  switch (role) {
    case "hidden_labels":
    case "reference_ranking":
    case "reference_scores":
      return "private";
    default:
      return "public";
  }
}

export function assignArtifactsFromProposal(input: {
  runtimeFamily: SupportedRuntimeFamily;
  uploadedArtifacts: AuthoringArtifactOutput[];
  artifactAssignments?: CompilerArtifactAssignment[];
}): ResolvedManagedArtifacts | null {
  const family = lookupManagedRuntimeFamily(input.runtimeFamily);
  const assignments = input.artifactAssignments ?? [];
  if (!family || assignments.length === 0) {
    return null;
  }

  const roleToAssignment = new Map<string, CompilerArtifactAssignment>();
  const usedIndexes = new Set<number>();
  for (const assignment of assignments) {
    if (usedIndexes.has(assignment.artifactIndex)) {
      throw new AgoraError(
        "Managed authoring compiler assigned the same uploaded file to multiple roles. Next step: retry the compile request or use Expert Mode.",
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily },
        },
      );
    }
    if (roleToAssignment.has(assignment.role)) {
      throw new AgoraError(
        "Managed authoring compiler returned duplicate artifact roles. Next step: retry the compile request or use Expert Mode.",
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily },
        },
      );
    }
    usedIndexes.add(assignment.artifactIndex);
    roleToAssignment.set(assignment.role, assignment);
  }

  const missingRoles = family.supportedArtifactRoles.filter(
    (role) => !roleToAssignment.has(role),
  );
  if (missingRoles.length > 0) {
    throw new AgoraError(
      `Managed authoring compiler could not assign all required artifact roles (${missingRoles.join(", ")}). Next step: rename the uploaded files to make their roles explicit or use Expert Mode.`,
      {
        code: "MANAGED_ARTIFACTS_AMBIGUOUS",
        status: 422,
        details: { runtimeFamily: input.runtimeFamily, missingRoles },
      },
    );
  }

  const resolvedArtifacts = family.supportedArtifactRoles.map((role) => {
    const assignment = roleToAssignment.get(role);
    const artifact =
      assignment && input.uploadedArtifacts[assignment.artifactIndex];
    if (!artifact) {
      throw new AgoraError(
        `Managed authoring compiler referenced a missing artifact for role ${role}. Next step: retry the compile request or use Expert Mode.`,
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily, role },
        },
      );
    }
    return {
      ...artifact,
      role,
      visibility: assignment?.visibility ?? defaultVisibilityForRole(role),
    };
  });

  switch (input.runtimeFamily) {
    case "reproducibility": {
      const sourceData = resolvedArtifacts.find(
        (artifact) => artifact.role === "source_data",
      );
      const referenceOutput = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_output",
      );
      const requiredColumns = referenceOutput?.detected_columns?.length
        ? referenceOutput.detected_columns
        : sourceData?.detected_columns?.length
          ? sourceData.detected_columns
          : ["id", "value"];
      return {
        resolvedArtifacts,
        evaluationBundle: referenceOutput?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns,
          idColumn: requiredColumns[0],
        }),
      };
    }
    case "tabular_regression":
    case "tabular_classification": {
      const evaluationFeatures = resolvedArtifacts.find(
        (artifact) => artifact.role === "evaluation_features",
      );
      const hiddenLabels = resolvedArtifacts.find(
        (artifact) => artifact.role === "hidden_labels",
      );
      const idColumn = inferIdColumn(evaluationFeatures);
      return {
        resolvedArtifacts,
        evaluationBundle: hiddenLabels?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "prediction"],
          idColumn,
          valueColumn: "prediction",
        }),
      };
    }
    case "ranking": {
      const rankingInputs = resolvedArtifacts.find(
        (artifact) => artifact.role === "ranking_inputs",
      );
      const referenceRanking = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_ranking",
      );
      const idColumn = inferIdColumn(rankingInputs);
      return {
        resolvedArtifacts,
        evaluationBundle: referenceRanking?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "score"],
          idColumn,
          valueColumn: "score",
        }),
      };
    }
    case "docking": {
      const referenceScores = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_scores",
      );
      return {
        resolvedArtifacts,
        evaluationBundle: referenceScores?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: ["ligand_id", "docking_score"],
          idColumn: "ligand_id",
          valueColumn: "docking_score",
        }),
      };
    }
  }
}
