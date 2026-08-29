import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_PREFIX = "tali_prb_v1";
const COORDINATOR_TOKEN_PREFIX = "tali_prc_v1";

export interface ProjectRuntimeBridgeIdentity {
  namespace: string;
  projectId: string;
}

function payload(identity: ProjectRuntimeBridgeIdentity): string {
  return Buffer.from(JSON.stringify({
    namespace: identity.namespace,
    projectId: identity.projectId,
    version: 1,
  })).toString("base64url");
}

function signature(encodedPayload: string, secret: string): string {
  if (!secret) {
    throw new Error("Project Runtime Bridge signing secret is not configured.");
  }
  return createHmac("sha256", secret)
    .update(`${TOKEN_PREFIX}.${encodedPayload}`)
    .digest("base64url");
}

function coordinatorSignature(encodedPayload: string, secret: string): string {
  if (!secret) {
    throw new Error("Project Runtime Bridge signing secret is not configured.");
  }
  return createHmac("sha256", secret)
    .update(`${COORDINATOR_TOKEN_PREFIX}.${encodedPayload}`)
    .digest("base64url");
}

export function signProjectRuntimeBridgeToken(
  identity: ProjectRuntimeBridgeIdentity,
  secret: string,
): string {
  const encodedPayload = payload(identity);
  return `${TOKEN_PREFIX}.${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export interface ProjectRuntimeCoordinatorIdentity
  extends ProjectRuntimeBridgeIdentity {
  coordinatorInstanceId: string;
  /**
   * Internal Durable Memory identity fixed when the Runtime credential is
   * issued. Runtime callers never select a provider Bank or Memory per call.
   */
  memoryId?: string;
}

export function signProjectRuntimeCoordinatorToken(
  identity: ProjectRuntimeCoordinatorIdentity,
  secret: string,
): string {
  const encodedPayload = Buffer.from(JSON.stringify({
    coordinatorInstanceId: identity.coordinatorInstanceId,
    ...(identity.memoryId ? { memoryId: identity.memoryId } : {}),
    namespace: identity.namespace,
    projectId: identity.projectId,
    version: 1,
  })).toString("base64url");
  return `${COORDINATOR_TOKEN_PREFIX}.${encodedPayload}.${coordinatorSignature(encodedPayload, secret)}`;
}

export function verifyProjectRuntimeCoordinatorToken(
  token: string,
  secret: string,
): ProjectRuntimeCoordinatorIdentity {
  const [prefix, encodedPayload, suppliedSignature, extra] = token.split(".");
  if (
    prefix !== COORDINATOR_TOKEN_PREFIX
    || !encodedPayload
    || !suppliedSignature
    || extra !== undefined
  ) {
    throw new Error("Invalid Project Runtime Coordinator token.");
  }
  const expected = Buffer.from(coordinatorSignature(encodedPayload, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (
    supplied.length !== expected.length
    || !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Invalid Project Runtime Coordinator token.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid Project Runtime Coordinator token.");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== 1
    || typeof (decoded as { projectId?: unknown }).projectId !== "string"
    || typeof (decoded as { namespace?: unknown }).namespace !== "string"
    || typeof (decoded as { coordinatorInstanceId?: unknown }).coordinatorInstanceId !== "string"
    || (
      (decoded as { memoryId?: unknown }).memoryId !== undefined
      && typeof (decoded as { memoryId?: unknown }).memoryId !== "string"
    )
  ) {
    throw new Error("Invalid Project Runtime Coordinator token.");
  }
  return {
    projectId: (decoded as { projectId: string }).projectId,
    namespace: (decoded as { namespace: string }).namespace,
    coordinatorInstanceId: (
      decoded as { coordinatorInstanceId: string }
    ).coordinatorInstanceId,
    ...((decoded as { memoryId?: string }).memoryId
      ? { memoryId: (decoded as { memoryId: string }).memoryId }
      : {}),
  };
}

export function verifyProjectRuntimeBridgeToken(
  token: string,
  secret: string,
): ProjectRuntimeBridgeIdentity {
  const [prefix, encodedPayload, suppliedSignature, extra] = token.split(".");
  if (
    prefix !== TOKEN_PREFIX
    || !encodedPayload
    || !suppliedSignature
    || extra !== undefined
  ) {
    throw new Error("Invalid Project Runtime Bridge token.");
  }
  const expected = Buffer.from(signature(encodedPayload, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (
    supplied.length !== expected.length
    || !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Invalid Project Runtime Bridge token.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid Project Runtime Bridge token.");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== 1
    || typeof (decoded as { projectId?: unknown }).projectId !== "string"
    || typeof (decoded as { namespace?: unknown }).namespace !== "string"
  ) {
    throw new Error("Invalid Project Runtime Bridge token.");
  }
  return {
    projectId: (decoded as { projectId: string }).projectId,
    namespace: (decoded as { namespace: string }).namespace,
  };
}
