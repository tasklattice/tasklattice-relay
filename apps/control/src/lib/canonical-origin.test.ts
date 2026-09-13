import { describe, expect, it } from "vitest";
import { canonicalLocation } from "./canonical-origin";

describe("canonicalLocation", () => {
  it("keeps an already canonical location unchanged", () => {
    expect(canonicalLocation(
      "http://localhost:38080/login?redirect=%2Faccess#form",
      "http://localhost:38080",
    )).toBeNull();
  });

  it("moves a legacy local hostname to the configured origin", () => {
    expect(canonicalLocation(
      "http://tali.localhost:38080/login?redirect=%2Faccess#form",
      "http://localhost:38080",
    )).toBe("http://localhost:38080/login?redirect=%2Faccess#form");
  });

  it("uses the configured scheme and port while preserving the route", () => {
    expect(canonicalLocation(
      "http://localhost:8081/projects/p1",
      "https://tali.example:8443",
    )).toBe("https://tali.example:8443/projects/p1");
  });
});
