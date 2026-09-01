import { z } from "zod";

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const semanticPathSchema = z.string().trim().min(1).max(240).regex(
  /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/,
  "Use a semantic dotted path such as employment.departureDate.",
);

type JsonPrimitive = boolean | number | string | null;
export type AnswerJsonValue =
  | JsonPrimitive
  | AnswerJsonValue[]
  | { [key: string]: AnswerJsonValue };

const answerJsonValueSchema: z.ZodType<AnswerJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(answerJsonValueSchema),
  z.record(z.string(), answerJsonValueSchema),
]));

export const answerEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(240),
  kind: z.enum(["AUTHORITATIVE_KNOWLEDGE", "TOOL_OUTPUT", "USER_INPUT"]),
  sourceId: z.string().trim().min(1).max(500),
  sourceRevision: z.string().trim().min(1).max(500).nullable(),
  title: z.string().trim().min(1).max(1_000),
  excerpt: z.string().trim().min(1).max(8_000).nullable(),
  uri: z.string().trim().min(1).max(4_000).nullable(),
  authoritative: z.boolean(),
  metadata: z.record(z.string(), answerJsonValueSchema).default({}),
}).strict().superRefine((value, context) => {
  const mustBeAuthoritative = value.kind === "AUTHORITATIVE_KNOWLEDGE"
    || value.kind === "TOOL_OUTPUT";
  if (value.authoritative !== mustBeAuthoritative) {
    context.addIssue({
      code: "custom",
      path: ["authoritative"],
      message: mustBeAuthoritative
        ? `${value.kind} evidence must be authoritative.`
        : "USER_INPUT provenance is contextual and cannot be marked as authoritative business knowledge.",
    });
  }
});

export const answerProvenanceSchema = z.object({
  kind: z.enum([
    "AUTHORITATIVE_KNOWLEDGE",
    "TOOL_OUTPUT",
    "USER_INPUT",
    "MEMORY_CONTEXT",
    "DERIVED",
  ]),
  sourceId: z.string().trim().min(1).max(500),
  sourceRevision: z.string().trim().min(1).max(500).nullable(),
  evidenceId: z.string().trim().min(1).max(240).nullable(),
  authoritative: z.boolean(),
  metadata: z.record(z.string(), answerJsonValueSchema).default({}),
}).strict().superRefine((value, context) => {
  const mustBeAuthoritative = value.kind === "AUTHORITATIVE_KNOWLEDGE"
    || value.kind === "TOOL_OUTPUT";
  if (value.authoritative !== mustBeAuthoritative) {
    context.addIssue({
      code: "custom",
      path: ["authoritative"],
      message: mustBeAuthoritative
        ? `${value.kind} provenance must be authoritative.`
        : `${value.kind} provenance cannot be used as authoritative business knowledge.`,
    });
  }
});

export const answerBlockSchema = z.object({
  id: semanticPathSchema,
  type: z.enum(["SUMMARY", "FIELD", "POLICY", "LIST", "CALLOUT", "HANDOVER", "CUSTOM"]),
  value: answerJsonValueSchema,
  revision: z.number().int().nonnegative(),
  contentHash: sha256DigestSchema,
  provenance: z.array(answerProvenanceSchema).max(200).default([]),
  dependsOn: z.array(semanticPathSchema).max(200).default([]),
  metadata: z.record(z.string(), answerJsonValueSchema).default({}),
}).strict();

export const answerDocumentSchema = z.object({
  kind: z.literal("ANSWER_DOCUMENT"),
  id: z.string().trim().min(1).max(500),
  revision: z.number().int().nonnegative(),
  status: z.enum(["ANSWER", "ABSTAIN", "ESCALATE", "CLARIFY"]),
  state: z.record(semanticPathSchema, answerJsonValueSchema).default({}),
  stateProvenance: z.record(
    semanticPathSchema,
    z.array(answerProvenanceSchema).min(1).max(20),
  ).default({}),
  blocks: z.array(answerBlockSchema).min(1).max(1_000),
  metadata: z.record(z.string(), answerJsonValueSchema).default({}),
}).strict().superRefine((value, context) => {
  const ids = value.blocks.map((block) => block.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["blocks"],
      message: "AnswerBlock IDs must remain unique within a document.",
    });
  }
});

const setStateOperationSchema = z.object({
  op: z.literal("SET_STATE"),
  path: semanticPathSchema,
  value: answerJsonValueSchema,
  expectedValueHash: sha256DigestSchema.optional(),
  provenance: z.array(answerProvenanceSchema).min(1).max(20),
}).strict();

const replaceBlockOperationSchema = z.object({
  op: z.literal("REPLACE_BLOCK"),
  block: answerBlockSchema,
  expectedBlockRevision: z.number().int().nonnegative(),
}).strict();

const addBlockOperationSchema = z.object({
  op: z.literal("ADD_BLOCK"),
  block: answerBlockSchema,
  afterBlockId: semanticPathSchema.nullable(),
}).strict();

const removeBlockOperationSchema = z.object({
  op: z.literal("REMOVE_BLOCK"),
  blockId: semanticPathSchema,
  expectedBlockRevision: z.number().int().nonnegative(),
}).strict();

export const answerPatchOperationSchema = z.discriminatedUnion("op", [
  setStateOperationSchema,
  replaceBlockOperationSchema,
  addBlockOperationSchema,
  removeBlockOperationSchema,
]);

export const answerPatchSchema = z.object({
  kind: z.literal("ANSWER_PATCH"),
  documentId: z.string().trim().min(1).max(500),
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(answerPatchOperationSchema).min(1).max(2_000),
  metadata: z.record(z.string(), answerJsonValueSchema).default({}),
}).strict().superRefine((value, context) => {
  const statePaths = value.operations
    .filter((operation) => operation.op === "SET_STATE")
    .map((operation) => operation.path);
  if (new Set(statePaths).size !== statePaths.length) {
    context.addIssue({
      code: "custom",
      path: ["operations"],
      message: "A semantic state path can be updated only once per AnswerPatch.",
    });
  }
  const blockIds = value.operations.flatMap((operation) => {
    if (operation.op === "REPLACE_BLOCK" || operation.op === "ADD_BLOCK") {
      return [operation.block.id];
    }
    if (operation.op === "REMOVE_BLOCK") return [operation.blockId];
    return [];
  });
  if (new Set(blockIds).size !== blockIds.length) {
    context.addIssue({
      code: "custom",
      path: ["operations"],
      message: "A block can be changed only once per AnswerPatch.",
    });
  }
});

export const answerArtifactSchema = z.discriminatedUnion("kind", [
  answerDocumentSchema,
  answerPatchSchema,
]);

export type AnswerEvidence = z.infer<typeof answerEvidenceSchema>;
export type AnswerProvenance = z.infer<typeof answerProvenanceSchema>;
export type AnswerBlock = z.infer<typeof answerBlockSchema>;
export type AnswerDocument = z.infer<typeof answerDocumentSchema>;
export type AnswerPatchOperation = z.infer<typeof answerPatchOperationSchema>;
export type AnswerPatch = z.infer<typeof answerPatchSchema>;
export type AnswerArtifact = z.infer<typeof answerArtifactSchema>;
