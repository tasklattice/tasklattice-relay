import { randomUUID } from "node:crypto";
import {
  expertAgentDefinitionInputSchema,
  expertAgentDefinitionSchema,
  expertAgentTestEvidenceSchema,
  expertAgentVersionManifestSchema,
  type ExpertAgentArtifactRef,
  type ExpertAgentDefinition,
  type ExpertAgentDefinitionInput,
  type ExpertAgentExecutionMode,
  type ExpertAgentTestEvidence,
  type ExpertAgentTestMode,
} from "@tali/contracts";
import {
  Prisma,
  type ExpertAgentRecord,
  type ExpertAgentTestRunRecord,
  type ExpertAgentVersionRecord,
  type PrismaClient,
} from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import {
  assessExpertAgentPublishReadiness,
  buildExpertAgentVersionSnapshot,
  expertAgentContentDigest,
  sha256,
  terminalTestEvidence,
} from "./expert-agent-domain";
import { createHash } from "node:crypto";

export class ExpertAgentNotFoundError extends Error {
  readonly code = "expert_agent_not_found";
  readonly status = 404;

  constructor() {
    super("The Agent was not found in the current Project.");
    this.name = "ExpertAgentNotFoundError";
  }
}

export class ExpertAgentVersionConflictError extends Error {
  readonly code = "expert_agent_version_conflict";
  readonly status = 409;

  constructor(message = "The Agent changed before this operation completed.") {
    super(message);
    this.name = "ExpertAgentVersionConflictError";
  }
}

export class ExpertAgentPublishGateError extends Error {
  readonly code = "expert_agent_publish_gate_failed";
  readonly status = 409;

  constructor(
    readonly details: ReturnType<typeof assessExpertAgentPublishReadiness>,
  ) {
    super(
      details.reason === "TESTS_OUTDATED"
        ? "The Agent changed after its latest Publish Test. Run the tests again."
        : details.reason === "TESTS_FAILED"
          ? "The current Agent did not pass its latest Publish Test."
          : "Run a Publish Test for the current Agent before publishing it.",
    );
    this.name = "ExpertAgentPublishGateError";
  }
}

export class ExpertAgentDeleteBlockedError extends Error {
  readonly code = "expert_agent_delete_blocked";
  readonly status = 409;

  constructor(readonly details: {
    instanceCount: number;
    dependentAgents: string[];
  }) {
    const reasons = [
      details.instanceCount > 0
        ? `${details.instanceCount} runtime Instance${details.instanceCount === 1 ? "" : "s"} still reference this Agent.`
        : null,
      details.dependentAgents.length > 0
        ? `It is still used by ${details.dependentAgents.join(", ")}.`
        : null,
    ].filter(Boolean).join(" ");
    super(`The Agent cannot be deleted yet. ${reasons}`);
    this.name = "ExpertAgentDeleteBlockedError";
  }
}

export interface CreateExpertAgentInput {
  projectId: string;
  actorId: string;
  slug: string;
  executionMode: ExpertAgentExecutionMode;
  definition: ExpertAgentDefinitionInput;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function definitionFromRecord(agent: ExpertAgentRecord): ExpertAgentDefinition {
  return expertAgentDefinitionSchema.parse({
    product: agent.productSpec,
    policy: agent.policySpec,
    delegations: agent.delegationSpec,
    acceptance: agent.acceptanceSpec,
    safety: agent.safetySpec,
    execution: agent.executionSpec,
    resources: agent.resourceBindings,
  });
}

function advisoryLockParts(projectId: string, agentId: string): [number, number] {
  const digest = createHash("sha256").update(`${projectId}\0${agentId}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function artifact(
  agentId: string,
  versionNumber: number,
  kind: ExpertAgentArtifactRef["kind"],
  mediaType: string,
  payload: unknown,
): ExpertAgentArtifactRef {
  const digest = sha256(payload);
  return {
    kind,
    mediaType,
    digest,
    uri: `agent-version://${agentId}/v${versionNumber}/${kind.toLowerCase()}`,
    sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
    metadata: {},
  };
}

export class ExpertAgentLifecycleService {
  constructor(private readonly db: PrismaClient = prisma()) {}

  async createAgent(input: CreateExpertAgentInput): Promise<ExpertAgentRecord> {
    const parsed = expertAgentDefinitionInputSchema.parse(input.definition);
    if (parsed.expectedRevision !== 0) {
      throw new ExpertAgentVersionConflictError("A new Agent must begin at revision 0.");
    }
    if (parsed.execution.mode !== input.executionMode) {
      throw new ExpertAgentVersionConflictError(
        "The Agent execution mode must match its execution definition.",
      );
    }
    await this.requireDelegationTargets({
      projectId: input.projectId,
      actorId: input.actorId,
      delegations: parsed.delegations,
    });
    const { expectedRevision: _expectedRevision, ...definition } = parsed;
    const agentId = randomUUID();
    const contentDigest = expertAgentContentDigest(buildExpertAgentVersionSnapshot({
      agentId,
      definition,
    }));

    return this.db.$transaction(async (transaction) => {
      const agent = await transaction.expertAgentRecord.create({
        data: {
          projectId: input.projectId,
          id: agentId,
          slug: input.slug,
          name: definition.product.name,
          description: definition.product.purpose,
          executionMode: input.executionMode,
          revision: 0,
          contentDigest,
          productSpec: json(definition.product),
          policySpec: json(definition.policy),
          delegationSpec: json(definition.delegations),
          acceptanceSpec: json(definition.acceptance),
          safetySpec: json(definition.safety),
          executionSpec: json(definition.execution),
          resourceBindings: json(definition.resources),
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });
      await transaction.expertAgentMemberRecord.create({
        data: {
          projectId: input.projectId,
          agentId: agent.id,
          userId: input.actorId,
          relation: "OWNER",
        },
      });
      return agent;
    });
  }

  async updateAgent(input: {
    projectId: string;
    agentId: string;
    actorId: string;
    definition: ExpertAgentDefinitionInput;
  }): Promise<ExpertAgentRecord> {
    const parsed = expertAgentDefinitionInputSchema.parse(input.definition);
    const current = await this.requireAccessibleAgent(input);
    if (parsed.execution.mode !== current.executionMode) {
      throw new ExpertAgentVersionConflictError(
        "Changing execution mode requires a new Agent.",
      );
    }
    await this.requireDelegationTargets({
      ...input,
      delegations: parsed.delegations,
    });
    const { expectedRevision, ...definition } = parsed;
    const contentDigest = expertAgentContentDigest(buildExpertAgentVersionSnapshot({
      agentId: input.agentId,
      definition,
    }));
    const updated = await this.db.expertAgentRecord.updateMany({
      where: {
        projectId: input.projectId,
        id: input.agentId,
        revision: expectedRevision,
        deletedAt: null,
      },
      data: {
        name: definition.product.name,
        description: definition.product.purpose,
        revision: { increment: 1 },
        contentDigest,
        productSpec: json(definition.product),
        policySpec: json(definition.policy),
        delegationSpec: json(definition.delegations),
        acceptanceSpec: json(definition.acceptance),
        safetySpec: json(definition.safety),
        executionSpec: json(definition.execution),
        resourceBindings: json(definition.resources),
        updatedBy: input.actorId,
      },
    });
    if (updated.count !== 1) throw new ExpertAgentVersionConflictError();
    return this.db.expertAgentRecord.findFirstOrThrow({
      where: { projectId: input.projectId, id: input.agentId },
    });
  }

  async deleteAgent(input: {
    projectId: string;
    agentId: string;
    actorId: string;
  }): Promise<{ id: string; deleted: true }> {
    await this.requireAccessibleAgent(input);
    return this.db.$transaction(async (transaction) => {
      const [projectLock, agentLock] = advisoryLockParts(input.projectId, input.agentId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${projectLock}, ${agentLock})::text AS locked`,
      );
      const agent = await transaction.expertAgentRecord.findFirst({
        where: {
          projectId: input.projectId,
          id: input.agentId,
          deletedAt: null,
        },
        select: { id: true, latestReleasedVersionId: true },
      });
      if (!agent) throw new ExpertAgentNotFoundError();

      const instanceCount = await transaction.agentRecord.count({
        where: {
          projectId: input.projectId,
          developedAgentId: input.agentId,
          deletedAt: null,
        },
      });

      const possibleDependents = await transaction.expertAgentRecord.findMany({
        where: {
          projectId: input.projectId,
          id: { not: input.agentId },
          deletedAt: null,
        },
        select: { name: true, delegationSpec: true },
      });
      const dependentAgents = possibleDependents
        .filter(({ delegationSpec }) => Array.isArray(delegationSpec)
          && delegationSpec.some((delegation) => delegation
            && typeof delegation === "object"
            && "expertAgentId" in delegation
            && delegation.expertAgentId === input.agentId))
        .map(({ name }) => name);
      if (instanceCount > 0 || dependentAgents.length > 0) {
        throw new ExpertAgentDeleteBlockedError({
          instanceCount,
          dependentAgents,
        });
      }

      await transaction.agentRecord.deleteMany({
        where: {
          projectId: input.projectId,
          developedAgentId: input.agentId,
        },
      });
      if (agent.latestReleasedVersionId) {
        await transaction.expertAgentRecord.update({
          where: {
            projectId_id: { projectId: input.projectId, id: input.agentId },
          },
          data: { latestReleasedVersionId: null },
        });
      }
      await transaction.expertAgentRecord.delete({
        where: {
          projectId_id: { projectId: input.projectId, id: input.agentId },
        },
      });
      return { id: input.agentId, deleted: true as const };
    });
  }

  async recordTestRun(input: {
    projectId: string;
    agentId: string;
    actorId: string;
    agentRevision: number;
    evidence: ExpertAgentTestEvidence;
  }): Promise<ExpertAgentTestRunRecord> {
    await this.requireAccessibleAgent(input);
    const evidence = terminalTestEvidence(input.evidence);
    return this.db.$transaction(async (transaction) => {
      const latest = await transaction.expertAgentTestRunRecord.aggregate({
        where: {
          projectId: input.projectId,
          agentId: input.agentId,
          agentRevision: input.agentRevision,
          mode: evidence.mode,
        },
        _max: { attempt: true },
      });
      return transaction.expertAgentTestRunRecord.create({
        data: {
          projectId: input.projectId,
          agentId: input.agentId,
          agentRevision: input.agentRevision,
          contentDigest: evidence.agentDigest,
          mode: evidence.mode,
          attempt: (latest._max.attempt ?? 0) + 1,
          status: evidence.status,
          evidence: json(evidence),
          failureReason: evidence.status === "FAILED" ? evidence.summary : null,
          createdBy: input.actorId,
          startedAt: new Date(evidence.startedAt),
          finishedAt: new Date(evidence.finishedAt!),
        },
      });
    });
  }

  async publishAgent(input: {
    projectId: string;
    agentId: string;
    actorId: string;
    expectedRevision: number;
    publicationNotes?: string;
    publishedAt?: Date;
  }): Promise<ExpertAgentVersionRecord> {
    await this.requireAccessibleAgent(input);
    return this.db.$transaction(async (transaction) => {
      const [projectLock, agentLock] = advisoryLockParts(input.projectId, input.agentId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${projectLock}, ${agentLock})::text AS locked`,
      );
      const agent = await transaction.expertAgentRecord.findFirst({
        where: {
          projectId: input.projectId,
          id: input.agentId,
          revision: input.expectedRevision,
          deletedAt: null,
        },
      });
      if (!agent) throw new ExpertAgentVersionConflictError();
      const existing = await transaction.expertAgentVersionRecord.findFirst({
        where: {
          projectId: input.projectId,
          agentId: input.agentId,
          contentDigest: agent.contentDigest,
        },
      });
      if (existing) return existing;
      const latestPublishTest = await transaction.expertAgentTestRunRecord.findFirst({
        where: {
          projectId: input.projectId,
          agentId: input.agentId,
          mode: "RELEASE",
        },
        orderBy: [{ createdAt: "desc" }, { attempt: "desc" }],
      });
      const readiness = assessExpertAgentPublishReadiness({
        contentDigest: agent.contentDigest,
        latestPublishTest,
      });
      if (!readiness.ready || !latestPublishTest) {
        throw new ExpertAgentPublishGateError(readiness);
      }

      const versionCount = await transaction.expertAgentVersionRecord.count({
        where: { projectId: input.projectId, agentId: input.agentId },
      });
      const versionNumber = versionCount + 1;
      const versionId = randomUUID();
      const publishedAt = input.publishedAt ?? new Date();
      const definition = definitionFromRecord(agent);
      const snapshot = buildExpertAgentVersionSnapshot({
        agentId: agent.id,
        definition,
      });
      if (expertAgentContentDigest(snapshot) !== agent.contentDigest) {
        throw new ExpertAgentVersionConflictError(
          "The stored Agent digest does not match its normalized definition.",
        );
      }

      const artifactPayloads: Array<{
        ref: ExpertAgentArtifactRef;
        payload: unknown;
      }> = [
        {
          payload: definition.execution,
          ref: artifact(
            agent.id,
            versionNumber,
            definition.execution.mode === "WORKFLOW" ? "PLAYBOOK" : "PROMPT",
            definition.execution.mode === "WORKFLOW"
              ? "application/vnd.tasklattice.playbook+json"
              : "application/vnd.tasklattice.prompt+json",
            definition.execution,
          ),
        },
        {
          payload: definition.resources,
          ref: artifact(
            agent.id,
            versionNumber,
            "RESOURCE_LOCK",
            "application/vnd.tasklattice.resource-lock+json",
            definition.resources,
          ),
        },
        {
          payload: latestPublishTest.evidence,
          ref: artifact(
            agent.id,
            versionNumber,
            "TEST_REPORT",
            "application/vnd.tasklattice.test-report+json",
            latestPublishTest.evidence,
          ),
        },
        {
          payload: {
            agentId: agent.id,
            revision: agent.revision,
            contentDigest: agent.contentDigest,
            publishedBy: input.actorId,
            publishedAt: publishedAt.toISOString(),
          },
          ref: artifact(
            agent.id,
            versionNumber,
            "PROVENANCE",
            "application/vnd.tasklattice.provenance+json",
            {
              agentId: agent.id,
              revision: agent.revision,
              contentDigest: agent.contentDigest,
              publishedBy: input.actorId,
              publishedAt: publishedAt.toISOString(),
            },
          ),
        },
      ];
      const artifactRefs = artifactPayloads.map(({ ref }) => ref);
      const artifactSetDigest = sha256(artifactRefs.map((ref) => ({
        kind: ref.kind,
        digest: ref.digest,
        uri: ref.uri,
      })));
      const testEvidence = expertAgentTestEvidenceSchema.parse(latestPublishTest.evidence);
      const manifest = expertAgentVersionManifestSchema.parse({
        schemaVersion: "agent-version-manifest/v1",
        agentId: agent.id,
        versionId,
        versionNumber,
        contentDigest: agent.contentDigest,
        executionMode: agent.executionMode,
        artifacts: artifactRefs,
        requirements: definition.resources,
        evidence: {
          testRunId: latestPublishTest.id,
          testedDigest: testEvidence.agentDigest,
          passedAt: testEvidence.finishedAt,
        },
        createdAt: publishedAt.toISOString(),
      });
      const manifestDigest = sha256(manifest);

      const version = await transaction.expertAgentVersionRecord.create({
        data: {
          projectId: input.projectId,
          id: versionId,
          agentId: agent.id,
          versionNumber,
          sourceRevision: agent.revision,
          contentDigest: agent.contentDigest,
          snapshot: json(snapshot),
          manifest: json(manifest),
          manifestDigest,
          artifactSetDigest,
          releaseNotes: input.publicationNotes?.trim() || null,
          gardenStatus: "PUBLISHED",
          publishedBy: input.actorId,
          publishedAt,
          artifacts: {
            create: artifactPayloads.map(({ ref }) => ({
              kind: ref.kind,
              mediaType: ref.mediaType,
              digest: ref.digest,
              uri: ref.uri,
              sizeBytes: ref.sizeBytes,
              metadata: json(ref.metadata),
            })),
          },
        },
      });
      await transaction.expertAgentRecord.update({
        where: {
          projectId_id: { projectId: input.projectId, id: input.agentId },
        },
        data: { latestReleasedVersionId: version.id },
      });
      return version;
    });
  }

  async requireAccessibleAgent(input: {
    projectId: string;
    agentId: string;
    actorId: string;
  }): Promise<ExpertAgentRecord> {
    const agent = await this.db.expertAgentRecord.findFirst({
      where: {
        projectId: input.projectId,
        id: input.agentId,
        deletedAt: null,
      },
    });
    if (!agent) throw new ExpertAgentNotFoundError();
    return agent;
  }

  private async requireDelegationTargets(input: {
    projectId: string;
    actorId: string;
    agentId?: string;
    delegations: ExpertAgentDefinition["delegations"];
  }): Promise<void> {
    const targetIds = input.delegations.map((delegation) => delegation.expertAgentId);
    if (input.agentId && targetIds.includes(input.agentId)) {
      throw new ExpertAgentVersionConflictError("An Agent cannot delegate to itself.");
    }
    if (!targetIds.length) return;
    const activeTargets = await this.db.expertAgentRecord.findMany({
      where: {
        projectId: input.projectId,
        id: { in: targetIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (activeTargets.length !== new Set(targetIds).size) {
      throw new ExpertAgentVersionConflictError(
        "Every delegated Agent must be active in the current Project.",
      );
    }
  }
}
