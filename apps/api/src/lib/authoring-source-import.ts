import type {
  AuthoringPartnerProviderOutput,
  CreateAuthoringSourceDraftRequestOutput,
} from "@agora/common";
import { AgoraError } from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftById,
  getAuthoringSourceLink,
  updateAuthoringDraft,
  upsertAuthoringSourceLink,
} from "@agora/db";
import { normalizeExternalArtifactsForDraft } from "./authoring-artifacts.js";
import { EXTERNAL_DRAFT_EXPIRY_MS } from "./authoring-draft-payloads.js";
import { createDraft, refreshDraftIr } from "./authoring-draft-transitions.js";
import { buildDraftUpdatedState } from "./authoring-drafts.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";

function externalDraftBusyError() {
  return new AgoraError(
    "Authoring draft is already compiling. Next step: wait for the current compile to finish or retry once the latest draft state is available.",
    {
      status: 409,
      code: "AUTHORING_DRAFT_BUSY",
    },
  );
}

export async function upsertExternalAuthoringDraftFromSource(input: {
  provider: AuthoringPartnerProviderOutput;
  body: CreateAuthoringSourceDraftRequestOutput;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringDraftImpl?: typeof createAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
  getAuthoringSourceLinkImpl?: typeof getAuthoringSourceLink;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  upsertAuthoringSourceLinkImpl?: typeof upsertAuthoringSourceLink;
  normalizeExternalArtifactsForDraftImpl?: typeof normalizeExternalArtifactsForDraft;
  logger?: AgoraLogger;
}) {
  const createSupabaseClientImpl =
    input.createSupabaseClientImpl ?? createSupabaseClient;
  const createAuthoringDraftImpl =
    input.createAuthoringDraftImpl ?? createAuthoringDraft;
  const getAuthoringDraftByIdImpl =
    input.getAuthoringDraftByIdImpl ?? getAuthoringDraftById;
  const getAuthoringSourceLinkImpl =
    input.getAuthoringSourceLinkImpl ?? getAuthoringSourceLink;
  const updateAuthoringDraftImpl =
    input.updateAuthoringDraftImpl ?? updateAuthoringDraft;
  const upsertAuthoringSourceLinkImpl =
    input.upsertAuthoringSourceLinkImpl ?? upsertAuthoringSourceLink;
  const normalizeExternalArtifactsForDraftImpl =
    input.normalizeExternalArtifactsForDraftImpl ??
    normalizeExternalArtifactsForDraft;

  const db = createSupabaseClientImpl(true);
  const uploadedArtifacts = await normalizeExternalArtifactsForDraftImpl({
    artifacts: input.body.artifacts,
  });

  const externalId = input.body.external_id ?? null;
  const existingLink =
    externalId == null
      ? null
      : await getAuthoringSourceLinkImpl(db, {
          provider: input.provider,
          external_id: externalId,
        });

  if (existingLink && externalId) {
    const existingDraft = await getAuthoringDraftByIdImpl(
      db,
      existingLink.draft_id,
    );
    if (existingDraft && existingDraft.state !== "published") {
      if (existingDraft.state === "compiling") {
        throw externalDraftBusyError();
      }
      const authoringIr = buildManagedAuthoringIr({
        intent: existingDraft.intent_json,
        uploadedArtifacts,
        sourceTitle: input.body.title ?? null,
        sourceMessages: input.body.messages,
        origin: {
          provider: input.provider,
          external_id: externalId,
          external_url: input.body.external_url ?? null,
          ingested_at: existingDraft.authoring_ir_json?.origin.ingested_at,
          raw_context: input.body.raw_context ?? null,
        },
      });
      const refreshed = await refreshDraftIr({
        db,
        session: existingDraft,
        state: buildDraftUpdatedState(existingDraft.state),
        intentJson: existingDraft.intent_json,
        authoringIrJson: authoringIr,
        uploadedArtifactsJson: uploadedArtifacts,
        expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftByIdImpl,
      });
      await upsertAuthoringSourceLinkImpl(db, {
        provider: input.provider,
        external_id: externalId,
        draft_id: refreshed.id,
        external_url: input.body.external_url ?? null,
      });
      input.logger?.info(
        {
          event: "authoring.drafts.refreshed",
          provider: input.provider,
          draftId: refreshed.id,
          externalId,
        },
        "Refreshed authoring draft from external source",
      );
      return refreshed;
    }
  }

  const authoringIr = buildManagedAuthoringIr({
    intent: null,
    uploadedArtifacts,
    sourceTitle: input.body.title ?? null,
    sourceMessages: input.body.messages,
    origin: {
      provider: input.provider,
      external_id: externalId,
      external_url: input.body.external_url ?? null,
      raw_context: input.body.raw_context ?? null,
    },
  });
  const session = await createDraft({
    db,
    state: "draft",
    authoringIrJson: authoringIr,
    uploadedArtifactsJson: uploadedArtifacts,
    expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
    createAuthoringDraftImpl,
    getAuthoringDraftByIdImpl,
  });

  if (externalId) {
    await upsertAuthoringSourceLinkImpl(db, {
      provider: input.provider,
      external_id: externalId,
      draft_id: session.id,
      external_url: input.body.external_url ?? null,
    });
  }

  input.logger?.info(
      {
        event: "authoring.drafts.created",
        provider: input.provider,
        draftId: session.id,
        externalId,
        questionCount: authoringIr.questions.pending.length,
      },
    "Created authoring draft from external source",
  );

  return session;
}
