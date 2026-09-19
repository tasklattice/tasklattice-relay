/** Development-only fixture. All Provider responses below are simulated; no API calls. */
import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelDeployment, ProviderAccount } from "@tali/contracts";
import {
  InferenceManagementProvider,
  type InferenceManagementClient,
} from "@/components/providers/inference-management-context";
import { ProviderManagement } from "@/components/providers/provider-management";
import { RegisterModelsDrawer } from "@/components/providers/register-models-drawer";
import { Button } from "@/components/ui/button";

const account: ProviderAccount = {
  id: "preview-provider",
  name: "Preview OpenAI",
  providerKind: "openai",
  presetId: "openai",
  endpoint: "https://example.invalid/v1",
  config: {},
  complianceDomain: "GLOBAL",
  endpointRegion: "global",
  crossBorderTransfer: false,
  discoveredModels: [],
  status: "VALIDATED",
  checks: [],
  credentialState: "STORED",
  validationMessage: "Simulated previous validation passed.",
  createdAt: "2026-09-19T00:00:00Z",
  updatedAt: "2026-09-19T00:00:00Z",
};
const existing: ModelDeployment = {
  id: "preview-model",
  providerAccountId: account.id,
  modelId: "existing-model",
  displayName: "Existing model",
  modelType: "llm",
  providerPresetId: "openai",
  providerName: account.name,
  endpoint: account.endpoint,
  complianceDomain: "GLOBAL",
  endpointRegion: "global",
  crossBorderTransfer: false,
  litellmModelName: "preview-model",
  status: "VALIDATED",
  checks: [],
  capabilities: [],
  inputModalities: ["text"],
  outputModalities: ["text"],
  validationMessage: "Simulated model ready.",
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
};
const delay = () => new Promise((resolve) => window.setTimeout(resolve, 800));

export function ProviderInteractionReview() {
  const [queryClient] = useState(() => new QueryClient());
  const [accounts, setAccounts] = useState([
    account,
    { ...account, id: "second-preview-provider", name: "Second Provider" },
  ]);
  const [models, setModels] = useState([existing]);
  const [open, setOpen] = useState(false);
  const [initialAccount, setInitialAccount] = useState<ProviderAccount>();
  const [notice, setNotice] = useState("");
  const failedOnce = useRef(false);
  const [client] = useState(
    () =>
      new Proxy(
        {
          revalidateProviderAccount: async (id: string) => {
            await delay();
            const failed = !failedOnce.current;
            failedOnce.current = true;
            const updated: ProviderAccount = {
              ...account,
              id,
              status: failed ? "FAILED" : "VALIDATED",
              checks: [
                {
                  id: "inference",
                  label: "Model inference",
                  status: failed ? "FAIL" : "PASS",
                },
              ],
              validationMessage: failed
                ? "Simulated upstream rejection. Retry validation."
                : "Simulated validation passed.",
            };
            setAccounts((items) =>
              items.map((item) =>
                item.id === id ? { ...item, ...updated } : item,
              ),
            );
            return updated;
          },
          discoverProviderAccountModels: async () => {
            await delay();
            return {
              providerKind: "openai",
              mode: "remote",
              checks: [{ id: "catalog", label: "Catalog", status: "PASS" }],
              message: "Simulated catalog; no upstream calls.",
              models: [
                {
                  modelId: "existing-model",
                  displayName: "Existing model",
                  modelType: "llm",
                },
                {
                  modelId: "new-model",
                  displayName: "New generation model",
                  modelType: "llm",
                },
                {
                  modelId: "embedding-model",
                  displayName: "Embedding model",
                  modelType: "text-embedding",
                },
              ],
            };
          },
          registerModelDeployment: async (
            input: Parameters<
              InferenceManagementClient["registerModelDeployment"]
            >[0],
          ) => {
            await delay();
            if (input.modelId.includes("fail"))
              throw new Error("Simulated registration failure.");
            const model: ModelDeployment = {
              ...existing,
              ...input,
              capabilities: input.capabilities ?? [],
              inputModalities: input.inputModalities ?? ["text"],
              outputModalities: input.outputModalities ?? ["text"],
              id: `preview-${input.modelId}`,
            };
            setModels((items) => [...items, model]);
            // Simulate a query refetch while the drawer is still open.
            setAccounts((items) => items.map((item) => ({ ...item })));
            setNotice(
              `Simulated submission: ${input.providerAccountId} / ${input.modelId}`,
            );
            return model;
          },
        },
        {
          get(target, property) {
            return property in target
              ? target[property as keyof typeof target]
              : () => {
                  throw new Error(
                    `Fixture does not implement ${String(property)}`,
                  );
                };
          },
        },
      ) as unknown as InferenceManagementClient,
  );
  return (
    <QueryClientProvider client={queryClient}>
      <InferenceManagementProvider
        value={{
          client,
          key: (...parts) => ["provider-review", ...parts],
          scopeLabel: "Project",
        }}
      >
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Provider interaction review</h2>
          <p className="text-sm text-muted-foreground">
            Simulated responses only. First validation fails; retry passes. IDs
            containing “fail” simulate registration failure.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setInitialAccount(undefined);
              setOpen(true);
            }}
          >
            Register from saved Provider
          </Button>
          <div className="rounded-lg border bg-card">
            <ProviderManagement
              accounts={accounts}
              models={models}
              canAdd={false}
              canDelete={false}
              canRegisterModels
              canValidate
              loading={false}
              onAddProvider={() => {}}
              onRegisterModels={(item) => {
                setInitialAccount(item);
                setOpen(true);
              }}
              onRetry={() => {}}
            />
          </div>
          {notice ? <p role="status">{notice}</p> : null}
          <RegisterModelsDrawer
            accounts={accounts}
            registeredModels={models}
            canConfigureProvider={false}
            initialAccount={initialAccount}
            open={open}
            onOpenChange={setOpen}
          />
        </section>
      </InferenceManagementProvider>
    </QueryClientProvider>
  );
}
