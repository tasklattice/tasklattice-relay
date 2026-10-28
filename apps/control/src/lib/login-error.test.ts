import { describe, expect, it } from "vitest";
import { classifyLoginError } from "./login-error";

describe("login error feedback", () => {
  it.each([
    [{ code: "INVALID_USERNAME_OR_PASSWORD", status: 401 }, "credentials"],
    [{ code: "CONTROL_ORIGIN_CONFIGURATION_ERROR", status: 403 }, "configuration"],
    [{ code: "CONTROL_ORIGIN_FORBIDDEN", status: 403 }, "origin"],
    [{ code: "INVALID_ORIGIN", status: 403 }, "origin"],
    [{ status: 403 }, "forbidden"],
    [{ status: 429 }, "rateLimit"],
    [{ status: 503 }, "service"],
    [new TypeError("Failed to fetch"), "network"],
    [{ status: 401 }, "unknown"],
    [{ message: "<html>proxy failure, password</html>" }, "unknown"],
    [null, "unknown"],
  ])("classifies %j as %s without displaying raw server text", (error, kind) => {
    expect(classifyLoginError(error)).toBe(kind);
  });
});
