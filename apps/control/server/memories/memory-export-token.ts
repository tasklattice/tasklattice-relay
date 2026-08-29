import { createHmac, timingSafeEqual } from "node:crypto";
import { getControlConfig } from "../config/control-config";

const PREFIX = "tali_mem_export_v1";
const DEFAULT_TTL_SECONDS = 5 * 60;

export interface MemoryExportClaims {
  actorId: string;
  expiresAt: number;
  memoryId: string;
  projectId: string;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${PREFIX}.${payload}`)
    .digest("base64url");
}

export function signMemoryExportToken(
  input: Omit<MemoryExportClaims, "expiresAt"> & { ttlSeconds?: number },
  secret = getControlConfig().auth.secret,
  now = Date.now(),
): { expiresAt: string; token: string } {
  const expiresAt = Math.floor(now / 1_000) + Math.max(
    1,
    Math.min(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, 15 * 60),
  );
  const payload = Buffer.from(JSON.stringify({
    actorId: input.actorId,
    expiresAt,
    memoryId: input.memoryId,
    projectId: input.projectId,
  } satisfies MemoryExportClaims), "utf8").toString("base64url");
  return {
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    token: `${PREFIX}.${payload}.${signature(payload, secret)}`,
  };
}

export function verifyMemoryExportToken(
  token: string,
  expected: Omit<MemoryExportClaims, "expiresAt">,
  secret = getControlConfig().auth.secret,
  now = Date.now(),
): MemoryExportClaims {
  const [prefix, payload, suppliedSignature, extra] = token.split(".");
  if (prefix !== PREFIX || !payload || !suppliedSignature || extra) {
    throw new Error("The Memory export authorization is invalid or expired.");
  }
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const calculated = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
    throw new Error("The Memory export authorization is invalid or expired.");
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
      Partial<MemoryExportClaims>;
    if (
      claims.actorId !== expected.actorId
      || claims.memoryId !== expected.memoryId
      || claims.projectId !== expected.projectId
      || !Number.isInteger(claims.expiresAt)
      || claims.expiresAt! <= Math.floor(now / 1_000)
    ) {
      throw new Error("Invalid claims.");
    }
    return claims as MemoryExportClaims;
  } catch {
    throw new Error("The Memory export authorization is invalid or expired.");
  }
}
