import { getRunnerConfig } from "./runner-config.js";
import {
  projectRuntimeNamespaceSchema,
  runnerRuntimeTargetSchema,
  type RunnerRuntimeTarget,
} from "@tali/contracts";
import type { OpenShellTarget } from "./openshell.js";

export { runnerRuntimeTargetSchema };
export type { RunnerRuntimeTarget };

export function projectTargetRoutingEnabled(): boolean {
  return getRunnerConfig().openshell.projectTargetRouting;
}

export function resolveOpenShellTarget(
  input?: RunnerRuntimeTarget,
): OpenShellTarget | undefined {
  if (!input) {
    if (projectTargetRoutingEnabled()) {
      throw new Error("A Project Runtime Target is required for this operation.");
    }
    return undefined;
  }
  const namespace = projectRuntimeNamespaceSchema.parse(input.namespace);
  const endpointTemplate =
    getRunnerConfig().openshell.gatewayEndpointTemplate?.trim()
    ?? "http://openshell-{namespace}.{namespace}.svc.cluster.local:8080";
  const gatewayEndpoint = endpointTemplate.replaceAll("{namespace}", namespace);
  const gatewayUrl = new URL(gatewayEndpoint);
  if (
    gatewayEndpoint.includes("{")
    || !["http:", "https:"].includes(gatewayUrl.protocol)
    || !gatewayUrl.hostname.endsWith(".svc.cluster.local")
    || gatewayUrl.username
    || gatewayUrl.password
    || gatewayUrl.pathname !== "/"
    || gatewayUrl.search
    || gatewayUrl.hash
  ) {
    throw new Error(
      "openshell.gatewayEndpointTemplate must resolve to a trusted Kubernetes Service URL.",
    );
  }
  return {
    gatewayEndpoint: gatewayUrl.toString().replace(/\/$/, ""),
    // OpenShell 0.0.106 uses the workspace in physical object and service-route
    // names. Matching it to the Project Namespace gives the shared edge proxy a
    // deterministic, database-free route to the correct Project Gateway.
    workspace: namespace,
    serviceBaseUrl:
      getRunnerConfig().openshell.serviceBaseUrl ?? "http://openshell.localhost:8080",
  };
}

export function sandboxStateKey(
  name: string,
  target?: RunnerRuntimeTarget,
): string {
  return `${target?.namespace ?? "legacy"}:${name}`;
}
