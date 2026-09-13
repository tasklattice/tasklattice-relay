import { catalogContracts } from "./catalog.contracts";
import type { RouteContract } from "./contract";
import { expertAgentContracts } from "./expert-agents.contracts";
import { identityContracts } from "./identity.contracts";
import { inferenceContracts } from "./inference.contracts";
import { instanceContracts } from "./instances.contracts";
import { memoryContracts } from "./memory.contracts";
import { platformContracts } from "./platform.contracts";

export const apiContracts: readonly RouteContract[] = Object.freeze([
  ...identityContracts,
  ...catalogContracts,
  ...expertAgentContracts,
  ...inferenceContracts,
  ...instanceContracts,
  ...memoryContracts,
  ...platformContracts,
]);

const contractIndex = new Map(
  apiContracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
);

export function findApiContract(method: string, path: string): RouteContract | undefined {
  return contractIndex.get(`${method.toUpperCase()} ${path}`);
}
