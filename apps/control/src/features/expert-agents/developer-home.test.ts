import { describe, expect, it } from "vitest";
import { instanceHealthTone } from "./developer-home-status";

describe("Developer Home current Instance health", () => {
  it("keeps the no-Instance state neutral", () => {
    expect(instanceHealthTone(0, 0)).toBeUndefined();
  });

  it("uses success only when every current Instance is healthy", () => {
    expect(instanceHealthTone(4, 4)).toBe("success");
    expect(instanceHealthTone(3, 4)).toBe("warning");
  });
});
