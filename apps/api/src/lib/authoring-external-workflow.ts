import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringInteractionStateOutput,
  type AuthoringPartnerProviderOutput,
  type CreateAuthoringSourceDraftRequestOutput,
  type ExternalSourceMessageOutput,
  type PublishExternalAuthoringDraftRequestOutput,
  type SubmitAuthoringSourceDraftRequestOutput,
  canonicalizeChallengeSpec,
  readAuthoringPartnerRuntimeConfig,
  readAuthoringSponsorRuntimeConfig,
  validateChallengeScoreability,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  type AuthoringDraftRow,
  AuthoringDraftWriteConflictError,
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftById,
  getAuthoringSourceLink,
  updateAuthoringDraft,
  upsertAuthoringSourceLink,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { normalizeExternalArtifactsForDraft } from "./authoring-artifacts.js";
import {
  EXTERNAL_DRAFT_EXPIRY_MS,
  isAuthoringDraftExpired,
} from "./authoring-draft-payloads.js";
import {
  failDraft,
  registerDraftCallback,
} from "./authoring-draft-transitions.js";
import {
  buildDraftNotFoundError,
  buildDraftUpdatedState,
  buildExpiredDraftError,
  deliverAuthoringDraftLifecycleEvent,
  deliverChallengeLifecycleEvent,
  draftBelongsToProvider,
  resolveAuthoringDraftReturnUrl,
  sweepPendingAuthoringDraftLifecycleEvents,
} from "./authoring-drafts.js";
import { createAuthoringIntakeWorkflow } from "./authoring-intake-workflow.js";
import {
  getAuthoringDraftSourceAttribution,
  withAuthoringDraftSourceAttribution,
} from "./authoring-source-attribution.js";
import { upsertExternalAuthoringDraftFromSource } from "./authoring-source-import.js";
import { sponsorAndPublishAuthoringDraft } from "./authoring-sponsored-publish.js";
import { compileManagedAuthoringDraftOutcome } from "./managed-authoring.js";

function toAgoraError(input: {
  status: number;
  code: string;
  message: string;
  retriable?: boolean;
  cause?: unknown;
}) {
  return new AgoraError(input.message, {
    status: input.status,
    code: input.code,
    retriable: input.retriable ?? false,
    cause: input.cause,
  });
}

function draftConflictError(cause?: unknown) {
  return toAgoraError({
    status: 409,
    code: "AUTHORING_DRAFT_CONFLICT",
    message:
      "Authoring draft changed during the update. Next step: reload the latest draft state from Agora and retry your change.",
    cause,
  });
}

function draftNotReadyError() {
  return toAgoraError({
    status: 409,
    code: "AUTHORING_DRAFT_NOT_READY",
    message:
      "Authoring draft is not ready to publish. Next step: compile the draft successfully before publishing.",
  });
}

function draftNotScoreableError(errors: string[]) {
  return toAgoraError({
    status: 409,
    code: "AUTHORING_DRAFT_NOT_SCOREABLE",
    message: `Authoring draft cannot publish because the compiled challenge spec is not scoreable yet. ${errors.join(" ")} Next step: fix the scoreability issues or switch to Expert Mode.`,
  });
}

function sponsorDisabledError() {
  return toAgoraError({
    status: 503,
    code: "AUTHORING_SPONSOR_DISABLED",
    message:
      "Sponsored external publishing is not configured. Next step: set AGORA_AUTHORING_SPONSOR_PRIVATE_KEY on the API and retry.",
  });
}

function draftLookupError(
  error:
    | ReturnType<typeof buildDraftNotFoundError>
    | ReturnType<typeof buildExpiredDraftError>,
) {
  return toAgoraError({
    status: error.status,
    code: error.code,
    message: error.message,
  });
}

async function safelyDeliverDraftLifecycleEvent(
  input: Parameters<typeof deliverAuthoringDraftLifecycleEvent>[0],
  deliverImpl: typeof deliverAuthoringDraftLifecycleEvent,
) {
  try {
    return await deliverImpl(input);
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.session.id,
        provider: input.session.authoring_ir_json?.origin.provider ?? "direct",
        eventType: input.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Authoring draft lifecycle delivery threw unexpectedly",
    );
    return false;
  }
}

async function safelyDeliverChallengeLifecycleEvent(
  input: Parameters<typeof deliverChallengeLifecycleEvent>[0],
  deliverImpl: typeof deliverChallengeLifecycleEvent,
) {
  try {
    return await deliverImpl(input);
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.session.id,
        provider: input.session.authoring_ir_json?.origin.provider ?? "direct",
        eventType: input.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Challenge lifecycle delivery threw unexpectedly",
    );
    return false;
  }
}

export type AuthoringExternalWorkflowDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftById?: typeof getAuthoringDraftById;
  getAuthoringSourceLink?: typeof getAuthoringSourceLink;
  updateAuthoringDraft?: typeof updateAuthoringDraft;
  upsertAuthoringSourceLink?: typeof upsertAuthoringSourceLink;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  normalizeExternalArtifactsForDraft?: typeof normalizeExternalArtifactsForDraft;
  pinJSON?: typeof pinJSON;
  canonicalizeChallengeSpec?: typeof canonicalizeChallengeSpec;
  readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
  readAuthoringSponsorRuntimeConfig?: typeof readAuthoringSponsorRuntimeConfig;
  deliverAuthoringDraftLifecycleEvent?: typeof deliverAuthoringDraftLifecycleEvent;
  sweepPendingAuthoringDraftLifecycleEvents?: typeof sweepPendingAuthoringDraftLifecycleEvents;
  sponsorAndPublishAuthoringDraft?: typeof sponsorAndPublishAuthoringDraft;
  deliverChallengeLifecycleEvent?: typeof deliverChallengeLifecycleEvent;
};

async function readPartnerDraft(input: {
  id: string;
  provider: AuthoringPartnerProviderOutput;
  createSupabaseClientImpl: typeof createSupabaseClient;
  getAuthoringDraftByIdImpl: typeof getAuthoringDraftById;
}) {
  const db = input.createSupabaseClientImpl(true);
  const draft = await input.getAuthoringDraftByIdImpl(db, input.id);
  if (!draft || !draftBelongsToProvider(draft, input.provider)) {
    throw draftLookupError(buildDraftNotFoundError());
  }
  if (isAuthoringDraftExpired(draft)) {
    throw draftLookupError(buildExpiredDraftError());
  }
  return draft;
}

export function createAuthoringExternalWorkflow(
  dependencies: AuthoringExternalWorkflowDependencies = {},
) {
  const createSupabaseClientImpl =
    dependencies.createSupabaseClient ?? createSupabaseClient;
  const createAuthoringDraftImpl =
    dependencies.createAuthoringDraft ?? createAuthoringDraft;
  const getAuthoringDraftByIdImpl =
    dependencies.getAuthoringDraftById ?? getAuthoringDraftById;
  const getAuthoringSourceLinkImpl =
    dependencies.getAuthoringSourceLink ?? getAuthoringSourceLink;
  const updateAuthoringDraftImpl =
    dependencies.updateAuthoringDraft ?? updateAuthoringDraft;
  const upsertAuthoringSourceLinkImpl =
    dependencies.upsertAuthoringSourceLink ?? upsertAuthoringSourceLink;
  const compileManagedAuthoringDraftOutcomeImpl =
    dependencies.compileManagedAuthoringDraftOutcome ??
    compileManagedAuthoringDraftOutcome;
  const normalizeExternalArtifactsForDraftImpl =
    dependencies.normalizeExternalArtifactsForDraft ??
    normalizeExternalArtifactsForDraft;
  const pinJSONImpl = dependencies.pinJSON ?? pinJSON;
  const canonicalizeChallengeSpecImpl =
    dependencies.canonicalizeChallengeSpec ?? canonicalizeChallengeSpec;
  const readAuthoringPartnerRuntimeConfigImpl =
    dependencies.readAuthoringPartnerRuntimeConfig ??
    readAuthoringPartnerRuntimeConfig;
  const readAuthoringSponsorRuntimeConfigImpl =
    dependencies.readAuthoringSponsorRuntimeConfig ??
    readAuthoringSponsorRuntimeConfig;
  const deliverAuthoringDraftLifecycleEventImpl =
    dependencies.deliverAuthoringDraftLifecycleEvent ??
    deliverAuthoringDraftLifecycleEvent;
  const sweepPendingAuthoringDraftLifecycleEventsImpl =
    dependencies.sweepPendingAuthoringDraftLifecycleEvents ??
    sweepPendingAuthoringDraftLifecycleEvents;
  const sponsorAndPublishAuthoringDraftImpl =
    dependencies.sponsorAndPublishAuthoringDraft ??
    sponsorAndPublishAuthoringDraft;
  const deliverChallengeLifecycleEventImpl =
    dependencies.deliverChallengeLifecycleEvent ??
    deliverChallengeLifecycleEvent;
  const intakeWorkflow = createAuthoringIntakeWorkflow({
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
  });

  return {
    async sweepCallbacks(input: { limit: number; logger?: AgoraLogger }) {
      return sweepPendingAuthoringDraftLifecycleEventsImpl(input);
    },

    async readDraft(input: {
      id: string;
      provider: AuthoringPartnerProviderOutput;
    }) {
      return readPartnerDraft({
        id: input.id,
        provider: input.provider,
        createSupabaseClientImpl,
        getAuthoringDraftByIdImpl,
      });
    },

    async submitDraft(input: {
      provider: AuthoringPartnerProviderOutput;
      body: SubmitAuthoringSourceDraftRequestOutput;
      logger?: AgoraLogger;
    }) {
      try {
        const { intent, ...sourceContext } = input.body;
        const draft = await upsertExternalAuthoringDraftFromSource({
          provider: input.provider,
          body: sourceContext satisfies CreateAuthoringSourceDraftRequestOutput,
          createSupabaseClientImpl,
          createAuthoringDraftImpl,
          getAuthoringDraftByIdImpl,
          getAuthoringSourceLinkImpl,
          updateAuthoringDraftImpl,
          upsertAuthoringSourceLinkImpl,
          normalizeExternalArtifactsForDraftImpl,
          logger: input.logger,
        });
        const db = createSupabaseClientImpl(true);
        const result = await intakeWorkflow.submitDraft({
          db,
          session: draft,
          intentCandidate: intent,
          uploadedArtifacts: draft.uploaded_artifacts_json ?? [],
          sourceTitle: draft.authoring_ir_json?.source.title ?? null,
          sourceMessages: draft.authoring_ir_json?.source.poster_messages ?? [],
          origin: {
            provider: input.provider,
            external_id: draft.authoring_ir_json?.origin.external_id ?? null,
            external_url: draft.authoring_ir_json?.origin.external_url ?? null,
            ingested_at: draft.authoring_ir_json?.origin.ingested_at,
            raw_context: draft.authoring_ir_json?.origin.raw_context ?? null,
          },
          draftExpiryMs: EXTERNAL_DRAFT_EXPIRY_MS,
          readyExpiryMs: EXTERNAL_DRAFT_EXPIRY_MS,
          getAuthoringDraftByIdImpl,
          updateAuthoringDraftImpl,
        });

        await safelyDeliverDraftLifecycleEvent(
          {
            event:
              result.draft.state === "failed"
                ? "draft_compile_failed"
                : "draft_compiled",
            session: result.draft,
            logger: input.logger,
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        if (result.compileError) {
          throw result.compileError;
        }

        return result.draft;
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          throw draftConflictError(error);
        }
        throw error;
      }
    },

    async submitSession(input: {
      provider: AuthoringPartnerProviderOutput;
      session?: AuthoringDraftRow | null;
      intentCandidate: Record<string, unknown> | null | undefined;
      uploadedArtifacts: AuthoringArtifactOutput[];
      sourceTitle?: string | null;
      sourceMessages?: ExternalSourceMessageOutput[];
      interaction?: AuthoringInteractionStateOutput | null;
      externalId?: string | null;
      externalUrl?: string | null;
      rawContext?: Record<string, unknown> | null;
      logger?: AgoraLogger;
    }) {
      try {
        const db = createSupabaseClientImpl(true);
        const result = await intakeWorkflow.submitDraft({
          db,
          session: input.session,
          intentCandidate: input.intentCandidate,
          uploadedArtifacts: input.uploadedArtifacts,
          sourceTitle: input.sourceTitle ?? null,
          sourceMessages: input.sourceMessages ?? [],
          interaction: input.interaction,
          origin: {
            provider: input.provider,
            external_id:
              input.externalId ??
              input.session?.authoring_ir_json?.origin.external_id ??
              null,
            external_url:
              input.externalUrl ??
              input.session?.authoring_ir_json?.origin.external_url ??
              null,
            ingested_at:
              input.session?.authoring_ir_json?.origin.ingested_at ??
              new Date().toISOString(),
            raw_context:
              input.rawContext ??
              input.session?.authoring_ir_json?.origin.raw_context ??
              null,
          },
          draftExpiryMs: EXTERNAL_DRAFT_EXPIRY_MS,
          readyExpiryMs: EXTERNAL_DRAFT_EXPIRY_MS,
          createAuthoringDraftImpl,
          getAuthoringDraftByIdImpl,
          updateAuthoringDraftImpl,
        });

        await safelyDeliverDraftLifecycleEvent(
          {
            event:
              result.draft.state === "failed"
                ? "draft_compile_failed"
                : "draft_compiled",
            session: result.draft,
            logger: input.logger,
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        return result;
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          throw draftConflictError(error);
        }
        throw error;
      }
    },

    async rejectSession(input: {
      id: string;
      provider: AuthoringPartnerProviderOutput;
      reason: string;
      logger?: AgoraLogger;
    }) {
      try {
        const db = createSupabaseClientImpl(true);
        const draft = await readPartnerDraft({
          id: input.id,
          provider: input.provider,
          createSupabaseClientImpl,
          getAuthoringDraftByIdImpl,
        });
        const rejectedDraft = await failDraft({
          db,
          session: draft,
          intentJson: draft.intent_json,
          authoringIrJson: draft.authoring_ir_json ?? null,
          uploadedArtifactsJson: draft.uploaded_artifacts_json ?? [],
          compilationJson: draft.compilation_json ?? null,
          message: input.reason,
          expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftByIdImpl,
        });

        await safelyDeliverDraftLifecycleEvent(
          {
            event: "draft_compile_failed",
            session: rejectedDraft,
            logger: input.logger,
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        return rejectedDraft;
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          throw draftConflictError(error);
        }
        throw error;
      }
    },

    async publishDraft(input: {
      id: string;
      provider: AuthoringPartnerProviderOutput;
      body: PublishExternalAuthoringDraftRequestOutput;
      logger?: AgoraLogger;
    }) {
      const db = createSupabaseClientImpl(true);
      const draft = await readPartnerDraft({
        id: input.id,
        provider: input.provider,
        createSupabaseClientImpl,
        getAuthoringDraftByIdImpl,
      });
      const returnTo = resolveAuthoringDraftReturnUrl({
        session: draft,
        requestedReturnTo: input.body.return_to,
        runtimeConfig: readAuthoringPartnerRuntimeConfigImpl(),
      });
      if (!returnTo.ok) {
        throw toAgoraError({
          status: returnTo.error.status,
          code: returnTo.error.code,
          message: returnTo.error.message,
        });
      }

      if (draft.state === "published" && draft.published_spec_cid) {
        return {
          draft,
          specCid: draft.published_spec_cid,
          spec:
            draft.published_spec_json ?? draft.compilation_json?.challenge_spec,
          returnTo: draft.published_return_to ?? returnTo.returnTo ?? undefined,
          returnToSource: returnTo.source,
          challenge:
            draft.published_challenge_id == null
              ? null
              : { challengeId: draft.published_challenge_id },
          txHash: null,
          sponsorAddress: null,
        };
      }

      if (draft.state !== "ready" || !draft.compilation_json) {
        throw draftNotReadyError();
      }

      const sponsorRuntime = readAuthoringSponsorRuntimeConfigImpl();
      if (!sponsorRuntime.privateKey) {
        throw sponsorDisabledError();
      }

      const canonicalSpec = withAuthoringDraftSourceAttribution(
        await canonicalizeChallengeSpecImpl(
          draft.compilation_json.challenge_spec,
          { resolveOfficialPresetDigests: true },
        ),
        getAuthoringDraftSourceAttribution(draft),
      );
      const scoreability = validateChallengeScoreability(canonicalSpec);
      if (!scoreability.ok) {
        throw draftNotScoreableError(scoreability.errors);
      }

      const specCid = await pinJSONImpl(`challenge-${draft.id}`, canonicalSpec);
      const published = await sponsorAndPublishAuthoringDraftImpl({
        db,
        draft,
        spec: canonicalSpec,
        specCid,
        sponsorPrivateKey: sponsorRuntime.privateKey,
        sponsorMonthlyBudgetUsdc:
          sponsorRuntime.monthlyBudgetsUsdc?.[input.provider] ?? null,
        returnTo: returnTo.returnTo,
        expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftByIdImpl,
      });

      await safelyDeliverDraftLifecycleEvent(
        {
          event: "draft_published",
          session: published.draft,
          logger: input.logger,
        },
        deliverAuthoringDraftLifecycleEventImpl,
      );
      await safelyDeliverChallengeLifecycleEvent(
        {
          event: "challenge_created",
          session: published.draft,
          challenge: {
            challenge_id: published.challenge.challengeId,
            contract_address: published.challenge.challengeAddress,
            factory_challenge_id: published.challenge.factoryChallengeId,
            status: "open",
            deadline: canonicalSpec.deadline,
            reward_total: canonicalSpec.reward.total,
            tx_hash: published.txHash,
            winner_solver_address: null,
          },
          logger: input.logger,
        },
        deliverChallengeLifecycleEventImpl,
      );

      return {
        draft: published.draft,
        specCid,
        spec: canonicalSpec,
        returnTo: returnTo.returnTo,
        returnToSource: returnTo.source,
        txHash: published.txHash,
        sponsorAddress: published.sponsorAddress,
        challenge: published.challenge,
      };
    },

    async registerWebhook(input: {
      id: string;
      provider: AuthoringPartnerProviderOutput;
      callbackUrl: string;
    }) {
      const draft = await readPartnerDraft({
        id: input.id,
        provider: input.provider,
        createSupabaseClientImpl,
        getAuthoringDraftByIdImpl,
      });
      const db = createSupabaseClientImpl(true);
      return registerDraftCallback({
        db,
        session: draft,
        callbackUrl: input.callbackUrl,
        updateAuthoringDraftImpl,
        getAuthoringDraftByIdImpl,
      });
    },
  };
}
