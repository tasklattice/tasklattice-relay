import { describe, expect, it } from "vitest";
import { skillTrustLevels } from "@tali/contracts";
import { getSkillAssurance } from "./skill-assurance";

describe("Skill source and risk evidence", () => {
  it("treats the historical UNSAFE marker as unverified, without inventing a risk finding", () => {
    expect(getSkillAssurance("UNSAFE")).toEqual({
      source: "unverified",
      sourceVerification: "notRecorded",
      riskAssessment: "notAssessed",
    });
  });

  it.each(skillTrustLevels)("does not promote the %s source marker into verification or risk evidence", (source) => {
    const assurance = getSkillAssurance(source);
    expect(assurance.sourceVerification).toBe("notRecorded");
    expect(assurance.riskAssessment).toBe("notAssessed");
  });
});
