import { instanceIdSchema } from "@tali/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { agentPlatformIds, type AgentPlatformId } from "@tali/contracts";
import { getControlConfig } from "../config/control-config";

const issuer = "tali-run-telemetry";
const audience = "tali-control";
const tokenLifetimeSeconds = 400 * 24 * 60 * 60;

const claimsSchema = z.object({
  aud: z.literal(audience),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
  iss: z.literal(issuer),
  projectId: z.string().min(1),
  instanceId: instanceIdSchema,
  agentPlatform: z.enum(agentPlatformIds),
}).strict();

export type RunTelemetryClaims = z.infer<typeof claimsSchema>;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(value: string): string {
  return createHmac("sha256", getControlConfig().auth.secret)
    .update(value)
    .digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function signRunTelemetryToken(input: {
  projectId: string;
  instanceId: string;
  agentPlatform: AgentPlatformId;
}): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({
    aud: audience,
    exp: now + tokenLifetimeSeconds,
    iat: now,
    iss: issuer,
    ...input,
  });
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${signature(unsigned)}`;
}

export function verifyRunTelemetryToken(token: string): RunTelemetryClaims {
  const [header, body, suppliedSignature] = token.split(".");
  if (!header || !body || !suppliedSignature) {
    throw new Error("Missing or invalid Run telemetry token.");
  }
  const unsigned = `${header}.${body}`;
  if (!equal(suppliedSignature, signature(unsigned))) {
    throw new Error("Invalid Run telemetry token signature.");
  }
  const claims = claimsSchema.parse(
    JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
  );
  if (claims.exp <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Run telemetry token expired.");
  }
  return claims;
}

export function runTelemetryBearerToken(request: Request): string {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
}
