import {
  expertAgentDefinitionSchema,
  expertAgentTestEvidenceSchema,
  expertAgentVersionManifestSchema,
  expertAgentVersionSnapshotSchema,
  type ExpertAgentResourceBinding,
} from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import { ProjectStore } from "../projects/project-store";
import { ExpertAgentResourceRevisionService } from "../runtime-bridge/expert-agent-runtime-resource-service";
import { assessExpertAgentPublishReadiness } from "./expert-agent-domain";
import { ExpertAgentNotFoundError } from "./expert-agent-lifecycle-service";

function lifecycleState(input: {
  contentDigest: string;
  latestVersionDigest: string | null;
  latestTest: { id: string; contentDigest: string; status: string; evidence: unknown } | null;
}) {
  if (input.latestVersionDigest === input.contentDigest) return "PUBLISHED" as const;
  const readiness = assessExpertAgentPublishReadiness({
    contentDigest: input.contentDigest,
    latestPublishTest: input.latestTest,
  });
  if (readiness.ready) return "READY_TO_PUBLISH" as const;
  if (readiness.reason === "TESTS_FAILED") return "TESTS_FAILED" as const;
  return "NEEDS_TESTING" as const;
}

function testRunView(run: {
  id: string;
  agentRevision: number;
  contentDigest: string;
  mode: string;
  attempt: number;
  status: string;
  evidence: unknown;
  failureReason: string | null;
  createdAt: Date;
  startedAt: Date;
  finishedAt: Date;
}) {
  const evidence = expertAgentTestEvidenceSchema.parse(run.evidence);
  return {
    id: run.id,
    agentRevision: run.agentRevision,
    contentDigest: run.contentDigest,
    mode: evidence.mode,
    attempt: run.attempt,
    status: evidence.status,
    evidence,
    failureReason: run.failureReason,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
  };
}

function versionView(version: {
  id: string;
  agentId: string;
  versionNumber: number;
  sourceRevision: number;
  contentDigest: string;
  snapshot: unknown;
  manifest: unknown;
  manifestDigest: string;
  artifactSetDigest: string;
  releaseNotes: string | null;
  gardenStatus: string;
  publishedBy: string;
  publishedAt: Date;
  artifacts: Array<{
    id: string;
    kind: string;
    mediaType: string;
    digest: string;
    uri: string;
    sizeBytes: number | null;
    metadata: unknown;
  }>;
}) {
  return {
    id: version.id,
    agentId: version.agentId,
    versionNumber: version.versionNumber,
    label: `v${version.versionNumber}`,
    sourceRevision: version.sourceRevision,
    contentDigest: version.contentDigest,
    snapshot: expertAgentVersionSnapshotSchema.parse(version.snapshot),
    manifest: expertAgentVersionManifestSchema.parse(version.manifest),
    manifestDigest: version.manifestDigest,
    artifactSetDigest: version.artifactSetDigest,
    publicationNotes: version.releaseNotes,
    gardenStatus: version.gardenStatus,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt.toISOString(),
    artifacts: version.artifacts.map((artifact) => ({
      ...artifact,
      metadata: artifact.metadata,
    })),
  };
}

export class ExpertAgentDeveloperService {
  constructor(private readonly db: PrismaClient = prisma()) {}

  async list(projectId: string, actorId: string) {
    const agents = await this.db.expertAgentRecord.findMany({
      where: {
        projectId,
        deletedAt: null,
        members: {
          some: {
            userId: actorId,
            relation: { in: ["OWNER", "MAINTAINER"] },
          },
        },
      },
      include: {
        members: { where: { userId: actorId }, select: { relation: true } },
        latestReleasedVersion: true,
        testRuns: {
          where: { mode: "RELEASE" },
          orderBy: [{ createdAt: "desc" }, { attempt: "desc" }],
          take: 1,
        },
        _count: { select: { runtimeInstances: true, versions: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return agents.map((agent) => {
      const latestTest = agent.testRuns[0] ?? null;
      return {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        executionMode: agent.executionMode,
        relation: agent.members[0]?.relation ?? "MAINTAINER",
        revision: agent.revision,
        contentDigest: agent.contentDigest,
        lifecycleState: lifecycleState({
          contentDigest: agent.contentDigest,
          latestVersionDigest: agent.latestReleasedVersion?.contentDigest ?? null,
          latestTest,
        }),
        latestVersion: agent.latestReleasedVersion
          ? {
              id: agent.latestReleasedVersion.id,
              versionNumber: agent.latestReleasedVersion.versionNumber,
              label: `v${agent.latestReleasedVersion.versionNumber}`,
              publishedAt: agent.latestReleasedVersion.publishedAt.toISOString(),
            }
          : null,
        latestTest: latestTest ? testRunView(latestTest) : null,
        versionCount: agent._count.versions,
        instanceCount: agent._count.runtimeInstances,
        updatedAt: agent.updatedAt.toISOString(),
      };
    });
  }

  async dashboard(projectId: string, actorId: string) {
    const agents = await this.list(projectId, actorId);
    return {
      kpis: {
        agents: agents.length,
        needsTesting: agents.filter((agent) => agent.lifecycleState === "NEEDS_TESTING").length,
        readyToPublish: agents.filter((agent) => agent.lifecycleState === "READY_TO_PUBLISH").length,
        published: agents.filter((agent) => agent.lifecycleState === "PUBLISHED").length,
      },
      attention: agents.filter((agent) => agent.lifecycleState !== "PUBLISHED"),
      recentAgents: agents.slice(0, 8),
    };
  }

  async detail(projectId: string, agentId: string, actorId: string) {
    const relation = await this.requireRelation(projectId, agentId, actorId);
    const agent = await this.db.expertAgentRecord.findFirst({
      where: { projectId, id: agentId, deletedAt: null },
      include: {
        versions: {
          include: { artifacts: true },
          orderBy: { versionNumber: "desc" },
        },
        testRuns: {
          orderBy: [{ createdAt: "desc" }, { attempt: "desc" }],
          take: 50,
        },
        _count: { select: { runtimeInstances: true } },
      },
    });
    if (!agent) throw new ExpertAgentNotFoundError();
    const definition = expertAgentDefinitionSchema.parse({
      product: agent.productSpec,
      policy: agent.policySpec,
      delegations: agent.delegationSpec,
      acceptance: agent.acceptanceSpec,
      safety: agent.safetySpec,
      execution: agent.executionSpec,
      resources: agent.resourceBindings,
    });
    const latestPublishTest = agent.testRuns.find((run) => run.mode === "RELEASE") ?? null;
    const latestVersion = agent.versions.find((version) =>
      version.id === agent.latestReleasedVersionId
    ) ?? null;
    const readiness = assessExpertAgentPublishReadiness({
      contentDigest: agent.contentDigest,
      latestPublishTest,
    });
    return {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      executionMode: agent.executionMode,
      relation: relation.relation,
      revision: agent.revision,
      contentDigest: agent.contentDigest,
      definition: { expectedRevision: agent.revision, ...definition },
      lifecycleState: lifecycleState({
        contentDigest: agent.contentDigest,
        latestVersionDigest: latestVersion?.contentDigest ?? null,
        latestTest: latestPublishTest,
      }),
      publishReadiness: readiness,
      latestVersion: latestVersion ? versionView(latestVersion) : null,
      versions: agent.versions.map(versionView),
      testRuns: agent.testRuns.map(testRunView),
      instanceCount: agent._count.runtimeInstances,
      createdBy: agent.createdBy,
      updatedBy: agent.updatedBy,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    };
  }

  async resourceRevisions(projectId: string, agentId: string, actorId: string) {
    const detail = await this.detail(projectId, agentId, actorId);
    const store = new ProjectStore(projectId, this.db);
    const resolver = new ExpertAgentResourceRevisionService(projectId, this.db);
    return Promise.all(detail.definition.resources.map(async (binding) => {
      try {
        const currentRevision = await this.currentRevision(binding, store, resolver);
        return {
          ...binding,
          currentRevision,
          available: currentRevision !== null,
          drifted: currentRevision !== null && currentRevision !== binding.revision,
        };
      } catch (error) {
        return {
          ...binding,
          currentRevision: null,
          available: false,
          drifted: true,
          error: error instanceof Error ? error.message : "Revision unavailable.",
        };
      }
    }));
  }

  async availableResources(projectId: string, agentId: string, actorId: string) {
    await this.requireRelation(projectId, agentId, actorId);
    const store = new ProjectStore(projectId, this.db);
    const resolver = new ExpertAgentResourceRevisionService(projectId, this.db);
    const [mcpServers, modelRoutings, vectorDatabases] = await Promise.all([
      store.listMcpServerDefinitions(),
      store.listModelRoutings(),
      store.listKnowledgeSourceDefinitions(),
    ]);
    const resources = [
      ...mcpServers.map((resource) => ({
        kind: "MCP_SERVER" as const,
        resourceId: resource.id,
        name: resource.name,
        status: resource.status,
        ready: resource.status === "HEALTHY",
        revision: resolver.mcp(resource),
        detail: `${resource.transport.toUpperCase()} · ${resource.tools.length} discovered tools`,
      })),
      ...modelRoutings.map((resource) => ({
        kind: "MODEL_ROUTING" as const,
        resourceId: resource.id,
        name: resource.name,
        status: resource.status,
        ready: resource.status === "READY",
        revision: resolver.modelRouting(resource.configurationHash),
        detail: `${resource.routingPolicy.mode} · ${resource.complianceDomain}`,
      })),
      ...(await Promise.all(vectorDatabases.map(async (resource) => {
        try {
          return {
            kind: "KNOWLEDGE_VECTOR_DATABASE" as const,
            resourceId: resource.id,
            name: resource.name,
            status: resource.status,
            ready: resource.status === "REGISTERED" && resource.provider === "postgresql",
            revision: await resolver.knowledge(resource.id),
            detail: `${resource.provider} · top ${resource.topK}`,
          };
        } catch {
          return {
            kind: "KNOWLEDGE_VECTOR_DATABASE" as const,
            resourceId: resource.id,
            name: resource.name,
            status: resource.status,
            ready: false,
            revision: null,
            detail: `${resource.provider} · revision unavailable`,
          };
        }
      }))),
    ];
    return resources.sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)
    );
  }

  private async currentRevision(
    binding: ExpertAgentResourceBinding,
    store: ProjectStore,
    resolver: ExpertAgentResourceRevisionService,
  ): Promise<string | null> {
    if (binding.kind === "MCP_SERVER") {
      const server = await store.getMcpServerDefinition(binding.resourceId);
      return server ? resolver.mcp(server) : null;
    }
    if (binding.kind === "MODEL_ROUTING") {
      const routing = await store.getModelRouting(binding.resourceId);
      return routing ? resolver.modelRouting(routing.configurationHash) : null;
    }
    if (binding.kind === "KNOWLEDGE_VECTOR_DATABASE") {
      return resolver.knowledge(binding.resourceId);
    }
    return binding.revision;
  }

  private async requireRelation(projectId: string, agentId: string, actorId: string) {
    const relation = await this.db.expertAgentMemberRecord.findFirst({
      where: {
        projectId,
        agentId,
        userId: actorId,
        relation: { in: ["OWNER", "MAINTAINER"] },
        agent: { deletedAt: null },
      },
    });
    if (!relation) throw new ExpertAgentNotFoundError();
    return relation;
  }
}
