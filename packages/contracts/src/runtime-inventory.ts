import { z } from "zod";
import { agentRuntimeClassificationSchema } from "./agent-domain.js";

export const runtimeInventorySourceTypes = [
  "WORKSPACE_INSTANCE",
  "MANAGED_A2A",
  "PROJECT_AGENT",
] as const;

export const runtimeInventoryStatuses = [
  "INACTIVE",
  "ACTIVATING",
  "PROVISIONING",
  "READY",
  "DEGRADED",
  "FAILED",
  "DESTROYING",
] as const;

export const runtimeInventoryIdentitySchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  username: z.string().trim().min(1),
}).strict();

export const runtimeInventoryItemSchema = z.object({
  id: z.string().trim().min(1),
  sourceType: z.enum(runtimeInventorySourceTypes),
  sourceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  classification: agentRuntimeClassificationSchema,
  subtype: z.string().trim().min(1),
  relation: z.enum(["OWNER", "MAINTAINER"]).nullable(),
  status: z.enum(runtimeInventoryStatuses),
  runtime: z.object({
    type: z.enum(["OPENSHELL", "KUBERNETES", "EXTERNAL"]),
    label: z.string().trim().min(1),
    namespace: z.string().nullable(),
    workloadName: z.string().nullable(),
    endpoint: z.string().nullable(),
  }).strict(),
  activeVersion: z.object({
    id: z.string().trim().min(1),
    versionNumber: z.number().int().positive(),
  }).strict().nullable(),
  ownership: z.object({
    createdBy: runtimeInventoryIdentitySchema.nullable(),
    creatorProvenance: z.enum([
      "RECORDED",
      "INFERRED_FROM_OWNER",
      "SOURCE_AGENT",
    ]),
    owners: z.array(runtimeInventoryIdentitySchema),
    maintainers: z.array(runtimeInventoryIdentitySchema),
    lastDeployedBy: runtimeInventoryIdentitySchema.nullable(),
  }).strict(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
}).strict();

export const runtimeInventoryResponseSchema = z.object({
  data: z.array(runtimeInventoryItemSchema),
  generatedAt: z.iso.datetime(),
}).strict();

export type RuntimeInventoryIdentity = z.infer<
  typeof runtimeInventoryIdentitySchema
>;
export type RuntimeInventoryItem = z.infer<typeof runtimeInventoryItemSchema>;
export type RuntimeInventoryResponse = z.infer<
  typeof runtimeInventoryResponseSchema
>;
export type RuntimeInventorySourceType =
  (typeof runtimeInventorySourceTypes)[number];
export type RuntimeInventoryStatus = (typeof runtimeInventoryStatuses)[number];
