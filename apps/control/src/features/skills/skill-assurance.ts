import type { SkillTrustLevel } from "@tali/contracts";

const sourceClassifications = {
  BUILT_IN: "builtIn",
  TRUSTED_SOURCE: "markedTrusted",
  UNSAFE: "unverified",
} as const satisfies Record<SkillTrustLevel, string>;

/** Legacy source markers carry neither verification evidence nor a risk verdict. */
export function getSkillAssurance(source: SkillTrustLevel) {
  return {
    source: sourceClassifications[source],
    sourceVerification: "notRecorded",
    riskAssessment: "notAssessed",
  } as const;
}
