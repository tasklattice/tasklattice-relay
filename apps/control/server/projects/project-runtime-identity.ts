import {
  generateKubernetesResourceId,
  kubernetesResourceName,
} from "@tali/contracts/resource-identity";

export const OPENSHELL_ROUTABLE_NAME_MAX_LENGTH = 19;
export const PROJECT_RUNTIME_NAMESPACE_PREFIX = "tp-";

export function projectRuntimeNamespace(projectId: string): string {
  return kubernetesResourceName("project", projectId);
}

export function generateProjectId(): string {
  return generateKubernetesResourceId("project");
}
