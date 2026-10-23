import { createWorkSchema, workCommandSchema, workStateSchema,
  personalConnectSchema, personalPrepareSchema, personalSetupStateSchema } from "@tali/contracts";
import { z } from "zod";
import { defineContracts } from "./contract";
import { projectRoute, response } from "./helpers";
import { projectParamsSchema } from "./schemas";

const workParams = projectParamsSchema.extend({ workId: z.string().uuid() });
const event = z.object({ sequence: z.number().int(), type: z.string(), summary: z.string(), createdAt: z.iso.datetime() });
const snapshot = z.object({
  id: z.string().uuid(), projectId: z.string(), revision: z.number().int(), state: workStateSchema,
  messages: z.array(z.object({ id: z.string(), kind: z.enum(["human", "agent"]), userId: z.string().nullable(),
    instanceId: z.string().nullable(), name: z.string(), text: z.string(), createdAt: z.iso.datetime(), source: z.string() })),
  events: z.array(event),
  runs: z.array(z.object({ id: z.string(), taskId: z.string().nullable(), instanceId: z.string(),
    status: z.string(), reason: z.string().nullable(), kind: z.string(), createdAt: z.iso.datetime() })),
}).meta({ id: "WorkSnapshot" });
const onboarding = z.object({
  eligible: z.boolean(), revision: z.number().int(), status: z.enum(["EMPTY", "CONNECTING", "CONNECTED", "PREPARING", "READY", "ERROR"]),
  busy: z.boolean(), interrupted: z.boolean(), error: z.string().nullable(), state: personalSetupStateSchema,
}).meta({ id: "PersonalOnboardingStatus" });

export const workContracts = defineContracts([
  projectRoute({ method: "get", path: "/works", operationId: "listWorks", tags: ["Works"],
    summary: "List work groups visible to the current user",
    responses: { 200: response("Work groups", z.array(z.object({ id: z.string().uuid(), title: z.string(), goal: z.string(),
      revision: z.number().int(), decisions: z.number().int() }))) } }),
  projectRoute({ method: "post", path: "/works", operationId: "createWork", tags: ["Works"],
    summary: "Create a work group", request: { body: createWorkSchema },
    responses: { 200: response("Created work group", z.object({ id: z.string().uuid() })), 413: response("Request exceeds 64000 bytes") } }),
  projectRoute({ method: "get", path: "/works/candidates", operationId: "listWorkCandidates", tags: ["Works"],
    summary: "List authorized ready Agent instances for a work group",
    responses: { 200: response("Candidate instances", z.array(z.object({ id: z.string(), name: z.string(), capability: z.string() }))) } }),
  projectRoute({ method: "get", path: "/works/{workId}", operationId: "getWork", tags: ["Works"],
    summary: "Read an atomic work group snapshot", request: { params: workParams },
    responses: { 200: response("Work snapshot", snapshot) } }),
  projectRoute({ method: "get", path: "/works/{workId}/events", operationId: "listWorkEvents", tags: ["Works"],
    summary: "Read durable work events after a sequence cursor", request: { params: workParams,
      query: z.object({ after: z.coerce.number().int().nonnegative().max(2147483647).default(0) }) },
    responses: { 200: response("Work events in ascending sequence order", z.array(event)) } }),
  projectRoute({ method: "post", path: "/works/{workId}/commands", operationId: "commandWork", tags: ["Works"],
    summary: "Apply an idempotent work command at an expected revision", request: { params: workParams, body: workCommandSchema },
    responses: { 200: response("Updated work snapshot", snapshot), 409: response("Revision or execution conflict"), 413: response("Request exceeds 64000 bytes") } }),
  projectRoute({ method: "get", path: "/personal-onboarding", operationId: "getPersonalOnboarding", tags: ["Personal onboarding"],
    summary: "Read personal Project setup status", responses: { 200: response("Setup status", onboarding) } }),
  projectRoute({ method: "post", path: "/personal-onboarding/connect", operationId: "connectPersonalOnboarding", tags: ["Personal onboarding"],
    summary: "Connect the personal Project model provider", request: { body: personalConnectSchema },
    responses: { 200: response("Setup status", onboarding), 409: response("Setup revision conflict"), 413: response("Request exceeds 20000 bytes") } }),
  projectRoute({ method: "post", path: "/personal-onboarding/prepare", operationId: "preparePersonalOnboarding", tags: ["Personal onboarding"],
    summary: "Prepare personal Project Agent instances", request: { body: personalPrepareSchema },
    responses: { 200: response("Setup status", onboarding), 409: response("Setup revision conflict"), 413: response("Request exceeds 20000 bytes") } }),
]);
