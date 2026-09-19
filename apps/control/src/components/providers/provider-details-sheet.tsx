import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ModelDeployment, ProviderAccount } from "@tali/contracts";
import { Plus, RefreshCw } from "lucide-react";
import {
  EntityDetailList,
  EntitySheet,
} from "@/components/shared/entity-sheet";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useInferenceManagement } from "./inference-management-context";

export function ProviderDetailsSheet({
  account,
  models,
  canValidate,
  canRegisterModels,
  onClose,
  onRegisterModels,
}: {
  account: ProviderAccount;
  models: ModelDeployment[];
  canValidate: boolean;
  canRegisterModels: boolean;
  onClose: () => void;
  onRegisterModels: () => void;
}) {
  const { client, key } = useInferenceManagement();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const validation = useMutation({
    mutationFn: () => client.revalidateProviderAccount(account.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key("provider-accounts") }),
        queryClient.invalidateQueries({ queryKey: key("model-deployments") }),
      ]);
    },
  });
  const current = validation.data ?? account;
  const filtered = models.filter((model) =>
    `${model.displayName} ${model.modelId}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const healthy = current.status === "VALIDATED";
  return (
    <EntitySheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={validation.isPending}
      title={account.name}
      description="Review this Provider, validate its saved connection, or register additional models."
      width="lg"
      footer={
        <>
          <Button
            variant="outline"
            disabled={validation.isPending}
            onClick={onClose}
          >
            Close
          </Button>
          {canValidate ? (
            <Button
              variant="outline"
              disabled={validation.isPending}
              onClick={() => validation.mutate()}
            >
              {validation.isPending ? <Spinner /> : <RefreshCw />}
              {validation.isPending ? "Validating…" : "Validate Provider"}
            </Button>
          ) : null}
          {canRegisterModels ? (
            <Button
              variant="create"
              disabled={validation.isPending}
              onClick={onRegisterModels}
            >
              <Plus />
              Register models
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-6">
        <EntityDetailList
          items={[
            { label: "Endpoint", value: current.endpoint, mono: true },
            { label: "Credentials", value: "Stored securely on the server" },
            {
              label: "TLS verification",
              value: current.skipTlsVerify ? "Disabled" : "Enabled",
            },
            {
              label: "Status",
              value: (
                <StatusBadge
                  label={
                    healthy
                      ? "Validated"
                      : current.status === "DEGRADED"
                        ? "Degraded"
                        : "Failed"
                  }
                  tone={
                    healthy
                      ? "success"
                      : current.status === "DEGRADED"
                        ? "warning"
                        : "danger"
                  }
                />
              ),
            },
            {
              label: "Last successful validation",
              value: current.validatedAt
                ? new Date(current.validatedAt).toLocaleString()
                : "Not available",
            },
          ]}
        />
        <section aria-label="Provider validation" className="space-y-3">
          <h3 className="text-sm font-semibold">Connection validation</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            Validation reuses the saved credentials and endpoint, discovers the
            catalog, and probes registered models through LiteLLM. It updates
            Provider and model statuses and may incur inference usage.
          </p>
          {validation.isPending ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Spinner />
              Checking the Provider and registered models…
            </p>
          ) : null}
          {validation.error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {validation.error.message} Retry validation when the connection is
              available.
            </p>
          ) : null}
          <div
            role={validation.data && !healthy ? "alert" : "status"}
            className="space-y-3 rounded-lg border p-4"
          >
            <p className="text-sm font-medium">
              {validation.data
                ? healthy
                  ? "Validation passed"
                  : current.status === "DEGRADED"
                    ? "Validation needs attention"
                    : "Validation failed"
                : "Last reported result"}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {current.validationMessage || "No validation details available."}
            </p>
            <ul aria-label="Validation checks" className="space-y-2">
              {current.checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span>{check.label}</span>
                  <StatusBadge
                    label={
                      check.status === "PASS"
                        ? "Passed"
                        : check.status === "FAIL"
                          ? "Failed"
                          : "Not required"
                    }
                    tone={
                      check.status === "PASS"
                        ? "success"
                        : check.status === "FAIL"
                          ? "danger"
                          : "neutral"
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="space-y-3" aria-label="Registered models">
          <h3 className="text-sm font-semibold">
            Registered models · {models.length}
          </h3>
          <Input
            aria-label="Search registered models"
            placeholder="Search by model name or ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {filtered.map((model) => (
              <li
                key={model.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <span className="min-w-0">
                  <strong className="block break-words text-sm">
                    {model.displayName}
                  </strong>
                  <code className="block break-all text-xs text-muted-foreground">
                    {model.modelId}
                  </code>
                </span>
                <StatusBadge
                  label={
                    model.status === "VALIDATED"
                      ? "Ready"
                      : model.status === "DEGRADED"
                        ? "Degraded"
                        : "Failed"
                  }
                  tone={
                    model.status === "VALIDATED"
                      ? "success"
                      : model.status === "DEGRADED"
                        ? "warning"
                        : "danger"
                  }
                />
              </li>
            ))}
            {!filtered.length ? (
              <li className="p-4 text-sm text-muted-foreground">
                {models.length
                  ? "No models match your search."
                  : "No models registered. Register models using this Provider’s saved credentials."}
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </EntitySheet>
  );
}
