import { createHash } from "node:crypto";
import {
  answerBlockSchema,
  answerDocumentSchema,
  answerPatchSchema,
  type AnswerBlock,
  type AnswerDocument,
  type AnswerJsonValue,
  type AnswerPatch,
  type AnswerProvenance,
} from "@tali/contracts";

type JsonValue = AnswerJsonValue;

function canonicalValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Answer artifacts cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function digest(value: JsonValue): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

export function answerStateValueHash(value: AnswerJsonValue | undefined): `sha256:${string}` {
  return value === undefined
    ? digest({ present: false })
    : digest({ present: true, value });
}

export function answerBlockContentHash(input: Pick<AnswerBlock, "type" | "value" | "metadata">): `sha256:${string}` {
  return digest({ type: input.type, value: input.value, metadata: input.metadata });
}

export function createAnswerBlock(input: Omit<AnswerBlock, "contentHash">): AnswerBlock {
  return answerBlockSchema.parse({
    ...input,
    contentHash: answerBlockContentHash(input),
  });
}

function pathAffectsDependency(path: string, dependency: string): boolean {
  return path === dependency
    || path.startsWith(`${dependency}.`)
    || dependency.startsWith(`${path}.`);
}

function assertBlockHash(block: AnswerBlock): void {
  const actual = answerBlockContentHash(block);
  if (block.contentHash !== actual) {
    throw new Error(`AnswerBlock ${block.id} content hash does not match its typed value.`);
  }
}

function requireBlock(blocks: Map<string, AnswerBlock>, id: string): AnswerBlock {
  const block = blocks.get(id);
  if (!block) throw new Error(`AnswerBlock ${id} does not exist in the base revision.`);
  return block;
}

export function applyAnswerPatch(
  documentInput: AnswerDocument,
  patchInput: AnswerPatch,
): AnswerDocument {
  const document = answerDocumentSchema.parse(documentInput);
  const patch = answerPatchSchema.parse(patchInput);
  if (patch.documentId !== document.id) {
    throw new Error("AnswerPatch targets a different AnswerDocument.");
  }
  if (patch.baseRevision !== document.revision) {
    throw new Error(
      `AnswerPatch base revision ${patch.baseRevision} does not match document revision ${document.revision}.`,
    );
  }
  document.blocks.forEach(assertBlockHash);

  const changedPaths = patch.operations.flatMap((operation) =>
    operation.op === "SET_STATE" ? [operation.path] : []
  );
  const changedBlockIds = new Set(patch.operations.flatMap((operation) => {
    if (operation.op === "REPLACE_BLOCK" || operation.op === "ADD_BLOCK") {
      return [operation.block.id];
    }
    if (operation.op === "REMOVE_BLOCK") return [operation.blockId];
    return [];
  }));
  const affectedBlockIds = new Set(document.blocks
    .filter((block) => block.dependsOn.some((dependency) =>
      changedPaths.some((path) => pathAffectsDependency(path, dependency))
    ))
    .map((block) => block.id));
  const missingRecomputations = [...affectedBlockIds].filter((id) => !changedBlockIds.has(id));
  if (missingRecomputations.length) {
    throw new Error(
      `AnswerPatch must recompute every affected block: ${missingRecomputations.join(", ")}.`,
    );
  }

  const state = { ...document.state };
  const stateProvenance: Record<string, AnswerProvenance[]> = {
    ...document.stateProvenance,
  };
  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  let order = document.blocks.map((block) => block.id);

  patch.operations.forEach((operation) => {
    if (operation.op === "SET_STATE") {
      if (
        operation.expectedValueHash
        && operation.expectedValueHash !== answerStateValueHash(state[operation.path])
      ) {
        throw new Error(`State path ${operation.path} changed after this patch was created.`);
      }
      state[operation.path] = operation.value;
      stateProvenance[operation.path] = operation.provenance;
      return;
    }
    if (operation.op === "REPLACE_BLOCK") {
      const current = requireBlock(blocks, operation.block.id);
      if (current.revision !== operation.expectedBlockRevision) {
        throw new Error(`AnswerBlock ${current.id} revision changed after this patch was created.`);
      }
      if (operation.block.revision !== current.revision + 1) {
        throw new Error(`Replacement AnswerBlock ${current.id} must increment its revision exactly once.`);
      }
      if (changedPaths.length && !affectedBlockIds.has(current.id)) {
        throw new Error(`AnswerPatch cannot rewrite unrelated block ${current.id}.`);
      }
      assertBlockHash(operation.block);
      blocks.set(current.id, operation.block);
      return;
    }
    if (operation.op === "ADD_BLOCK") {
      if (blocks.has(operation.block.id)) {
        throw new Error(`AnswerBlock ${operation.block.id} already exists.`);
      }
      if (operation.block.revision !== 0) {
        throw new Error(`New AnswerBlock ${operation.block.id} must start at revision 0.`);
      }
      assertBlockHash(operation.block);
      blocks.set(operation.block.id, operation.block);
      const afterIndex = operation.afterBlockId === null
        ? -1
        : order.indexOf(operation.afterBlockId);
      if (operation.afterBlockId !== null && afterIndex < 0) {
        throw new Error(`AnswerBlock ${operation.afterBlockId} cannot be used as an insertion anchor.`);
      }
      order = [
        ...order.slice(0, afterIndex + 1),
        operation.block.id,
        ...order.slice(afterIndex + 1),
      ];
      return;
    }
    const current = requireBlock(blocks, operation.blockId);
    if (current.revision !== operation.expectedBlockRevision) {
      throw new Error(`AnswerBlock ${current.id} revision changed after this patch was created.`);
    }
    if (changedPaths.length && !affectedBlockIds.has(current.id)) {
      throw new Error(`AnswerPatch cannot remove unrelated block ${current.id}.`);
    }
    blocks.delete(current.id);
    order = order.filter((id) => id !== current.id);
  });

  if (!order.length) throw new Error("AnswerDocument must retain at least one block.");
  return answerDocumentSchema.parse({
    ...document,
    revision: document.revision + 1,
    state,
    stateProvenance,
    blocks: order.map((id) => blocks.get(id)!),
    metadata: { ...document.metadata, ...patch.metadata },
  });
}
