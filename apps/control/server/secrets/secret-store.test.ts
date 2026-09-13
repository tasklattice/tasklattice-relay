import { describe, expect, it } from "vitest";
import { kubernetesSecretLabels } from "./secret-store";

describe("kubernetesSecretLabels", () => {
  it("normalizes Department scope identifiers into valid Kubernetes labels", () => {
    expect(kubernetesSecretLabels(
      "department:dep1",
      "provider:52A0D350-532A-4B79-B1D6-DF83661441AB",
    )).toEqual({
      "app.kubernetes.io/managed-by": "tali",
      "tali.io/project-id": "department-dep1",
      "tali.io/resource-id": "provider-52a0d350-532a-4b79-b1d6-df83661441ab",
    });
  });

  it("keeps label values within the Kubernetes 63-character boundary", () => {
    const labels = kubernetesSecretLabels("p".repeat(100), "r".repeat(100));
    expect(labels["tali.io/project-id"]).toHaveLength(63);
    expect(labels["tali.io/resource-id"]).toHaveLength(63);
  });
});
