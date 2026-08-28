import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  providerPresets,
  type ModelDeployment,
  type ProviderAccount,
  type ProviderResourceStatus,
} from "@tali/contracts";
import {
  Ellipsis,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { ProviderIcon } from "./provider-icon";
import { useInferenceManagement } from "./inference-management-context";
import { DataBoundaryLabel } from "@/components/shared/data-boundary-label";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function ProviderManagement({
  accounts,
  canAdd,
  canDelete,
  canRegisterModels,
  canValidate,
  error,
  loading,
  models,
  onAddProvider,
  onRegisterModels,
  onRetry,
}: {
  accounts: ProviderAccount[];
  canAdd: boolean;
  canDelete: boolean;
  canRegisterModels: boolean;
  canValidate: boolean;
  error?: string | undefined;
  loading: boolean;
  models: ModelDeployment[];
  onAddProvider: () => void;
  onRegisterModels: (account: ProviderAccount) => void;
  onRetry: () => void;
}) {
  const [actionError, setActionError] = useState("");
  const { scopeLabel } = useInferenceManagement();

  return (
    <section aria-labelledby="providers-title">
      <div className="flex flex-col gap-4 p-5 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="providers-title" className="text-sm font-semibold">
              Providers
            </h3>
            <Badge variant="outline">{accounts.length}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Configured model sources owned by this {scopeLabel}. Each Provider
            supplies credentials, an endpoint, and a data boundary for its
            registered models.
          </p>
        </div>
        {canAdd ? (
          <Button className="h-11 self-start sm:self-auto" onClick={onAddProvider}>
            <Plus />
            Add Provider
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="border-y border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex min-h-36 items-center justify-center gap-2 border-t text-sm text-muted-foreground">
          <Spinner />
          Loading Providers…
        </div>
      ) : error ? (
        <div className="flex min-h-36 flex-col items-center justify-center border-t p-5 text-center">
          <TriangleAlert className="size-5 text-destructive" />
          <p className="mt-2 max-w-lg text-sm text-destructive">{error}</p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : accounts.length ? (
        <>
          <div className="hidden overflow-x-auto border-t md:block">
            <table className="w-full min-w-[800px] text-left">
              <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">Endpoint</th>
                  <th className="px-4 py-2.5 font-medium">Registered models</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Boundary</th>
                  <th className="w-14">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map((account) => {
                  const accountModels = models.filter(
                    (model) => model.providerAccountId === account.id,
                  );
                  return (
                    <tr key={account.id} className="hover:bg-muted/[0.12]">
                      <td className="px-5 py-3">
                        <ProviderIdentity account={account} />
                      </td>
                      <td className="px-4 py-3">
                        <ProviderEndpoint account={account} />
                      </td>
                      <td className="px-4 py-3">
                        <strong className="block text-xs font-medium">
                          {accountModels.length} model
                          {accountModels.length === 1 ? "" : "s"}
                        </strong>
                        <span className="mt-0.5 block max-w-64 truncate text-[11px] text-muted-foreground">
                          {accountModels
                            .map((model) => model.displayName)
                            .join(", ") || "No models registered"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ProviderStatus status={account.status} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <DataBoundaryLabel domain={account.complianceDomain} />
                      </td>
                      <td className="px-2 py-3">
                        <ProviderActions
                          account={account}
                          canDelete={canDelete}
                          canRegisterModels={canRegisterModels}
                          canValidate={canValidate}
                          modelCount={accountModels.length}
                          onError={setActionError}
                          onRegisterModels={() => onRegisterModels(account)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y border-t md:hidden">
            {accounts.map((account) => {
              const accountModels = models.filter(
                (model) => model.providerAccountId === account.id,
              );
              return (
                <article key={account.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <ProviderIdentity account={account} />
                    <ProviderActions
                      account={account}
                      canDelete={canDelete}
                      canRegisterModels={canRegisterModels}
                      canValidate={canValidate}
                      modelCount={accountModels.length}
                      onError={setActionError}
                      onRegisterModels={() => onRegisterModels(account)}
                    />
                  </div>
                  <ProviderEndpoint account={account} />
                  <p className="text-xs text-muted-foreground">
                    {accountModels.length} registered model
                    {accountModels.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex items-center justify-between border-t pt-3 text-xs">
                    <ProviderStatus status={account.status} />
                    <DataBoundaryLabel
                      className="text-muted-foreground"
                      domain={account.complianceDomain}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="grid min-h-48 place-items-center border-t bg-muted/[0.08] p-6 text-center">
          <div>
            <span className="mx-auto grid size-9 place-items-center rounded-md border bg-background text-muted-foreground">
              <ServerCog className="size-4" />
            </span>
            <h4 className="mt-3 text-sm font-semibold">No Providers configured</h4>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Add a Provider by configuring its credentials and registering its
              first model for this {scopeLabel}.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProviderActions({
  account,
  canDelete,
  canRegisterModels,
  canValidate,
  modelCount,
  onError,
  onRegisterModels,
}: {
  account: ProviderAccount;
  canDelete: boolean;
  canRegisterModels: boolean;
  canValidate: boolean;
  modelCount: number;
  onError: (message: string) => void;
  onRegisterModels: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { client, key } = useInferenceManagement();
  const queryClient = useQueryClient();
  const invalidate = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key("provider-accounts") }),
      queryClient.invalidateQueries({ queryKey: key("model-deployments") }),
    ]);
  const revalidate = useMutation({
    mutationFn: () => client.revalidateProviderAccount(account.id),
    onMutate: () => onError(""),
    onSuccess: invalidate,
    onError: (error) => onError(error.message),
  });
  const remove = useMutation({
    mutationFn: () => client.deleteProviderAccount(account.id),
    onMutate: () => onError(""),
    onSuccess: async () => {
      setDeleteOpen(false);
      await invalidate();
    },
    onError: (error) => onError(error.message),
  });
  const pending = revalidate.isPending || remove.isPending;

  if (!canDelete && !canRegisterModels && !canValidate) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${account.name}`}
            disabled={pending}
          >
            {pending ? <Spinner /> : <Ellipsis />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRegisterModels ? (
            <DropdownMenuItem onSelect={onRegisterModels}>
              <Plus />
              Register models
            </DropdownMenuItem>
          ) : null}
          {canValidate ? (
            <DropdownMenuItem
              disabled={revalidate.isPending}
              onSelect={() => revalidate.mutate()}
            >
              <RefreshCw />
              Revalidate Provider
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              {canRegisterModels || canValidate ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={remove.isPending}
                onSelect={() => {
                  remove.reset();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 />
                Delete Provider
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteEntitySheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Provider"
        description={
          <>
            Delete <strong>{account.name}</strong> and its {modelCount} registered
            model{modelCount === 1 ? "" : "s"}.
          </>
        }
        entityName={account.name}
        confirmLabel="Delete Provider"
        deleting={remove.isPending}
        onConfirm={() => remove.mutate()}
        {...(remove.error instanceof Error ? { error: remove.error.message } : {})}
        impactDescription="The Provider disappears from this scope. Deletion is blocked while any registered model is referenced by a Routing or Instance."
      />
    </>
  );
}

function ProviderIdentity({ account }: { account: ProviderAccount }) {
  const providerName = providerPresets.find(
    (provider) => provider.id === account.providerKind,
  )?.name ?? account.providerKind;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProviderIcon
        presetId={account.presetId}
        className="size-9 shrink-0 [&_img]:size-5"
      />
      <span className="min-w-0">
        <strong className="block truncate text-sm font-medium">
          {account.name}
        </strong>
        <span className="block truncate text-[11px] text-muted-foreground">
          {providerName}
        </span>
      </span>
    </span>
  );
}

function ProviderEndpoint({ account }: { account: ProviderAccount }) {
  let host = account.endpoint;
  try {
    host = new URL(account.endpoint).host;
  } catch {
    // Preserve the configured value when it is not a URL-shaped endpoint.
  }
  return (
    <span className="min-w-0 text-xs">
      <span className="block truncate font-mono">{host}</span>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
        {account.endpointRegion}
      </span>
      {account.skipTlsVerify ? (
        <span className="mt-1 block text-[11px] font-medium text-amber-700 dark:text-amber-300">
          TLS verification disabled
        </span>
      ) : null}
    </span>
  );
}

function ProviderStatus({ status }: { status: ProviderResourceStatus }) {
  const ready = status === "VALIDATED";
  const degraded = status === "DEGRADED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-medium",
        ready
          ? "text-emerald-700"
          : degraded
            ? "text-amber-700"
            : "text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          ready
            ? "bg-emerald-500"
            : degraded
              ? "bg-amber-500"
              : "bg-current",
        )}
      />
      {ready ? "Healthy" : degraded ? "Degraded" : "Failed"}
    </span>
  );
}
