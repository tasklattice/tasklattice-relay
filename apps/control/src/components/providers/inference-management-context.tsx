import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/api";

export type InferenceManagementClient = Pick<
  typeof api,
  | "listInferenceGateways"
  | "listModelRoutings"
  | "getModelRouting"
  | "createModelRouting"
  | "updateModelRouting"
  | "refreshModelRouting"
  | "deleteModelRouting"
  | "listModelRoutingConsumers"
  | "listModelRoutingAudit"
  | "listProviderAccounts"
  | "discoverProviderModels"
  | "discoverProviderAccountModels"
  | "registerProviderAccount"
  | "revalidateProviderAccount"
  | "deleteProviderAccount"
  | "listModelDeployments"
  | "registerModelDeployment"
  | "deleteModelDeployment"
  | "getModelRemovalImpact"
>;

interface InferenceManagementContextValue {
  client: InferenceManagementClient;
  key: (...parts: string[]) => readonly unknown[];
  scopeLabel: "Project" | "Department";
}

const InferenceManagementContext = createContext<
  InferenceManagementContextValue | undefined
>(undefined);

export function InferenceManagementProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: InferenceManagementContextValue;
}) {
  return (
    <InferenceManagementContext.Provider value={value}>
      {children}
    </InferenceManagementContext.Provider>
  );
}

export function useInferenceManagement() {
  const context = useContext(InferenceManagementContext);
  if (!context) {
    throw new Error(
      "Inference management components require InferenceManagementProvider.",
    );
  }
  return context;
}
