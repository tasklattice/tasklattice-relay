import { describe, expect, it } from "vitest";
import {
  signRunTelemetryToken,
  verifyRunTelemetryToken,
} from "./run-telemetry-token";

describe("Run telemetry token", () => {
  it("round-trips only the scoped Project and Instance claims", () => {
    const token = signRunTelemetryToken({
      projectId: "individual",
      instanceId: "ti-abcdefghijklm",
      agentPlatform: "openclaw",
    });
    expect(verifyRunTelemetryToken(token)).toMatchObject({
      projectId: "individual",
      instanceId: "ti-abcdefghijklm",
      agentPlatform: "openclaw",
    });
  });

  it("rejects a tampered scope", () => {
    const token = signRunTelemetryToken({
      projectId: "individual",
      instanceId: "ti-abcdefghijklm",
      agentPlatform: "hermes",
    });
    const [header, body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    claims.projectId = "project-b";
    const tampered = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    expect(() => verifyRunTelemetryToken(tampered)).toThrow("signature");
  });
});
