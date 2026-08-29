import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  hasValidatedEmbeddingModel,
  type CreateVectorDatabaseDefinitionInput,
  vectorDatabaseFormLimits,
} from "@tali/contracts";
import { ArrowRight, Database, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmbeddingModelSetupNotice } from "@/components/providers/embedding-model-setup-notice";
import {
  getVectorStoreProvider,
  VectorStoreProviderIcon,
  VectorStoreProviderSelect,
} from "@/components/knowledge/vector-store-provider";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type VectorDatabaseFormField,
  validateVectorDatabaseDraft,
} from "@/features/vector-database-form-validation";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export const Route = createFileRoute("/$projectId/vector-databases/")({
  component: VectorDatabases,
});

const emptyDraft: CreateVectorDatabaseDefinitionInput = {
  credentialReference: "",
  description: "",
  name: "",
  provider: "postgresql",
  topK: 8,
  vectorStoreId: "",
};

function VectorDatabases() {
  const projectId = useCurrentProjectId();
  const permissions = useProjectPermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const catalog = useQuery({ queryKey: scope.key("resource-catalog"), queryFn: api.getResourceCatalog });
  const models = useQuery({ queryKey: scope.key("model-deployments"), queryFn: api.listModelDeployments });
  const items = catalog.data?.vectorDatabases ?? [];
  const embeddingModels = (models.data ?? []).filter(
    (model) => model.status === "VALIDATED" && model.modelType === "text-embedding",
  );
  const embeddingModelReady = hasValidatedEmbeddingModel(models.data ?? []);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CreateVectorDatabaseDefinitionInput>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [formAttempted, setFormAttempted] = useState(false);

  const create = useMutation({
    mutationFn: api.createVectorDatabase,
    onSuccess: async (database) => {
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
      setFormOpen(false);
      setDraft(emptyDraft);
      setFormAttempted(false);
      await navigate({
        to: "/$projectId/vector-databases/$databaseId",
        params: { projectId, databaseId: database.id },
      });
    },
  });

  const submit = () => {
    setFormAttempted(true);
    if (!embeddingModelReady) {
      setFormError("Configure a validated embedding model before creating a Vector Database.");
      return;
    }
    const validation = validateVectorDatabaseDraft(draft);
    if (!validation.result.success) {
      setFormError(validation.formError);
      return;
    }
    setFormError("");
    create.mutate(validation.result.data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vector Databases"
        description="Create a built-in PostgreSQL Vector Database or connect an advanced provider for Project-scoped Agent recall."
        actions={!permissions.canCreateVectorDatabases && !permissions.canManageProject ? undefined : models.isPending ? (
          <Button className="h-11" disabled>Checking embedding…</Button>
        ) : models.error ? (
          <Button className="h-11" disabled>Embedding unavailable</Button>
        ) : !embeddingModelReady && permissions.canManageProject ? (
          <Button asChild className="h-11">
            <Link
              to="/$projectId/setting"
              params={{ projectId }}
              search={{ section: "models" }}
            >
              Configure embedding <ArrowRight />
            </Link>
          </Button>
        ) : embeddingModelReady ? (
          <Button
            className="h-11"
            disabled={!permissions.canCreateVectorDatabases}
            onClick={() => { setDraft(emptyDraft); setFormError(""); setFormAttempted(false); create.reset(); setFormOpen(true); }}
          >
            <Plus /> Create Vector Database
          </Button>
        ) : undefined}
      />

      {models.error ? <Notice tone="error">Embedding model availability could not be loaded: {models.error.message}</Notice> : null}
      {!models.isPending && !models.error && !embeddingModelReady ? (
        <EmbeddingModelSetupNotice
          canManageProject={permissions.canManageProject}
          projectId={projectId}
          showAction={false}
        />
      ) : null}
      {catalog.error ? <Notice tone="error">{catalog.error.message}</Notice> : null}
      {catalog.isPending ? (
        <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Project Vector Databases</CardTitle>
            <CardDescription>Built-in storage includes Docling document ingestion. Advanced providers remain managed through their native service.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {items.length ? items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void navigate({
                  to: "/$projectId/vector-databases/$databaseId",
                  params: { projectId, databaseId: item.id },
                })}
                className="grid min-h-28 w-full gap-4 border-b px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[minmax(0,1fr)_11rem_8rem_2.75rem] sm:items-center"
              >
                <span className="flex min-w-0 items-start gap-3">
                  <VectorStoreProviderIcon provider={item.provider} />
                  <span className="min-w-0 pt-0.5">
                    <strong className="block truncate">{item.name}</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{item.vectorStoreId}</span>
                  </span>
                </span>
                <Fact label="Provider" value={getVectorStoreProvider(item.provider).label} />
                <StatusDot label={item.status} tone={item.status === "REGISTERED" ? "success" : "danger"} />
                <span className="grid size-11 place-items-center text-muted-foreground"><ArrowRight className="size-4" /></span>
              </button>
            )) : (
              <div className="px-6 py-16 text-center">
                <Database className="mx-auto size-7 text-muted-foreground" />
                <strong className="mt-3 block">No Vector Databases</strong>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Start with the built-in PostgreSQL option to upload documents, parse them with Docling, and expose recall through LiteLLM.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <EntitySheet
        open={formOpen}
        onOpenChange={(open) => { if (!create.isPending) setFormOpen(open); }}
        eyebrow="Vector Databases"
        title="Create Vector Database"
        description="Use TaskLattice PostgreSQL for the built-in experience, or connect a provider-managed Vector Database."
        width="md"
        footer={(
          <>
            <Button variant="outline" disabled={create.isPending} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button disabled={!embeddingModelReady || create.isPending} onClick={submit}>{create.isPending ? "Creating…" : "Create"}</Button>
          </>
        )}
      >
        <VectorDatabaseForm
          key={formOpen ? "open" : "closed"}
          draft={draft}
          embeddingModels={embeddingModels}
          validationAttempted={formAttempted}
          onChange={(next) => { setDraft(next); setFormError(""); }}
        />
        {formError || create.error ? <div className="mt-4"><Notice tone="error">{formError || create.error?.message}</Notice></div> : null}
      </EntitySheet>
    </div>
  );
}

function VectorDatabaseForm({ draft, embeddingModels, onChange, validationAttempted }: {
  draft: CreateVectorDatabaseDefinitionInput;
  embeddingModels: Array<{ id: string; displayName: string; litellmModelName: string }>;
  onChange: (next: CreateVectorDatabaseDefinitionInput) => void;
  validationAttempted: boolean;
}) {
  const [touchedFields, setTouchedFields] = useState<Set<VectorDatabaseFormField>>(
    () => new Set(),
  );
  const set = <K extends keyof CreateVectorDatabaseDefinitionInput>(key: K, value: CreateVectorDatabaseDefinitionInput[K]) => onChange({ ...draft, [key]: value });
  const validation = validateVectorDatabaseDraft(draft);
  const touch = (field: VectorDatabaseFormField) => {
    setTouchedFields((current) => {
      if (current.has(field)) return current;
      const next = new Set(current);
      next.add(field);
      return next;
    });
  };
  const errorFor = (field: VectorDatabaseFormField) => (
    touchedFields.has(field) || validationAttempted ? validation.fieldErrors[field] ?? "" : ""
  );
  const nameError = errorFor("name");
  const descriptionError = errorFor("description");
  const vectorStoreIdError = errorFor("vectorStoreId");
  const topKError = errorFor("topK");
  const embeddingModelError = errorFor("embeddingModelDeploymentId");
  const apiBaseError = errorFor("apiBase");
  const credentialReferenceError = errorFor("credentialReference");
  const semanticFieldError = errorFor("semanticField");
  const contentFieldError = errorFor("contentField");
  const providerConnectionRequired = draft.provider === "pg_vector" || draft.provider === "elasticsearch";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="vector-name">Name</Label>
        <Input
          id="vector-name"
          className="h-11"
          value={draft.name}
          minLength={vectorDatabaseFormLimits.name.min}
          maxLength={vectorDatabaseFormLimits.name.max}
          required
          aria-invalid={Boolean(nameError)}
          aria-describedby="vector-name-help"
          aria-errormessage={nameError ? "vector-name-help" : undefined}
          onBlur={() => touch("name")}
          onChange={(event) => { touch("name"); set("name", event.target.value); }}
          placeholder="Engineering Research"
        />
        <FieldFeedback
          id="vector-name-help"
          error={nameError}
          hint={`Enter ${vectorDatabaseFormLimits.name.min}–${vectorDatabaseFormLimits.name.max} characters.`}
          count={`${draft.name.trim().length}/${vectorDatabaseFormLimits.name.max}`}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="vector-description">Description</Label>
        <Input
          id="vector-description"
          className="h-11"
          value={draft.description}
          minLength={vectorDatabaseFormLimits.description.min}
          maxLength={vectorDatabaseFormLimits.description.max}
          required
          aria-invalid={Boolean(descriptionError)}
          aria-describedby="vector-description-help"
          aria-errormessage={descriptionError ? "vector-description-help" : undefined}
          onBlur={() => touch("description")}
          onChange={(event) => { touch("description"); set("description", event.target.value); }}
          placeholder="Research documents used by Project Agents."
        />
        <FieldFeedback
          id="vector-description-help"
          error={descriptionError}
          hint={`Enter ${vectorDatabaseFormLimits.description.min}–${vectorDatabaseFormLimits.description.max} characters.`}
          count={`${draft.description.trim().length}/${vectorDatabaseFormLimits.description.max}`}
        />
      </div>
      <div className="space-y-2"><Label htmlFor="vector-provider">Provider</Label><VectorStoreProviderSelect id="vector-provider" value={draft.provider} onValueChange={(provider) => onChange({ ...draft, provider, embeddingModelDeploymentId: undefined, embeddingModel: undefined, embeddingDimensions: undefined })} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vector-id">Vector Database ID</Label>
          <Input
            id="vector-id"
            className="h-11 font-mono"
            value={draft.vectorStoreId}
            minLength={vectorDatabaseFormLimits.vectorStoreId.min}
            maxLength={vectorDatabaseFormLimits.vectorStoreId.max}
            required
            aria-invalid={Boolean(vectorStoreIdError)}
            aria-describedby="vector-id-help"
            aria-errormessage={vectorStoreIdError ? "vector-id-help" : undefined}
            onBlur={() => touch("vectorStoreId")}
            onChange={(event) => { touch("vectorStoreId"); set("vectorStoreId", event.target.value); }}
            placeholder={draft.provider === "postgresql" ? "engineering-research" : "vs_..."}
          />
          <FieldFeedback
            id="vector-id-help"
            error={vectorStoreIdError}
            hint={`Required, up to ${vectorDatabaseFormLimits.vectorStoreId.max} characters.`}
            count={`${draft.vectorStoreId.trim().length}/${vectorDatabaseFormLimits.vectorStoreId.max}`}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vector-top-k">Default Top K</Label>
          <Input
            id="vector-top-k"
            className="h-11"
            type="number"
            min={vectorDatabaseFormLimits.topK.min}
            max={vectorDatabaseFormLimits.topK.max}
            step={1}
            value={Number.isNaN(draft.topK) ? "" : draft.topK}
            required
            aria-invalid={Boolean(topKError)}
            aria-describedby="vector-top-k-help"
            aria-errormessage={topKError ? "vector-top-k-help" : undefined}
            onBlur={() => touch("topK")}
            onChange={(event) => {
              touch("topK");
              set("topK", event.target.value === "" ? Number.NaN : Number(event.target.value));
            }}
          />
          <FieldFeedback
            id="vector-top-k-help"
            error={topKError}
            hint={`Enter a whole number from ${vectorDatabaseFormLimits.topK.min} to ${vectorDatabaseFormLimits.topK.max}.`}
          />
        </div>
      </div>

      {draft.provider === "postgresql" ? (
        <div className="space-y-3 border bg-muted/20 p-4">
          <div><strong className="text-sm">Built-in foundation</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Documents are parsed by Docling, embedded through the selected Project model, and stored in Project-isolated PGVector.</p></div>
          <div className="space-y-2">
            <Label htmlFor="vector-embedding">Embedding model</Label>
            <Select required value={draft.embeddingModelDeploymentId ?? ""} onValueChange={(id) => {
              const model = embeddingModels.find((item) => item.id === id);
              touch("embeddingModelDeploymentId");
              onChange({ ...draft, embeddingModelDeploymentId: id, embeddingModel: model?.litellmModelName, embeddingDimensions: undefined });
            }}>
              <SelectTrigger
                id="vector-embedding"
                size="lg"
                className="w-full"
                aria-invalid={Boolean(embeddingModelError)}
                aria-describedby="vector-embedding-help"
                aria-errormessage={embeddingModelError ? "vector-embedding-help" : undefined}
                onBlur={() => touch("embeddingModelDeploymentId")}
              >
                <SelectValue placeholder="Select a validated embedding model" />
              </SelectTrigger>
              <SelectContent>{embeddingModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}<span className="ml-2 font-mono text-xs text-muted-foreground">{model.litellmModelName}</span></SelectItem>)}</SelectContent>
            </Select>
            <FieldFeedback
              id="vector-embedding-help"
              error={embeddingModelError}
              hint={embeddingModels.length
                ? "Select a validated Project embedding model."
                : "Create and validate a text-embedding model before using built-in storage."}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="vector-api-base">Provider API base</Label>
            <Input
              id="vector-api-base"
              className="h-11 font-mono"
              type="url"
              value={draft.apiBase ?? ""}
              required={providerConnectionRequired}
              aria-invalid={Boolean(apiBaseError)}
              aria-describedby="vector-api-base-help"
              aria-errormessage={apiBaseError ? "vector-api-base-help" : undefined}
              onBlur={() => touch("apiBase")}
              onChange={(event) => { touch("apiBase"); set("apiBase", event.target.value); }}
              placeholder="https://vector.example.com"
            />
            <FieldFeedback
              id="vector-api-base-help"
              error={apiBaseError}
              hint={providerConnectionRequired ? "Required. Enter a valid provider API URL." : "Optional. Enter a valid URL when provided."}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vector-credential">Credential reference</Label>
            <Input
              id="vector-credential"
              className="h-11 font-mono"
              value={draft.credentialReference}
              maxLength={vectorDatabaseFormLimits.credentialReference.max}
              required={providerConnectionRequired}
              aria-invalid={Boolean(credentialReferenceError)}
              aria-describedby="vector-credential-help"
              aria-errormessage={credentialReferenceError ? "vector-credential-help" : undefined}
              onBlur={() => touch("credentialReference")}
              onChange={(event) => { touch("credentialReference"); set("credentialReference", event.target.value); }}
              placeholder="k8s://project/vector-provider"
            />
            <FieldFeedback
              id="vector-credential-help"
              error={credentialReferenceError}
              hint={`${providerConnectionRequired ? "Required. " : "Optional. "}Use a k8s:// or memory:// Secret reference.`}
              count={`${draft.credentialReference.trim().length}/${vectorDatabaseFormLimits.credentialReference.max}`}
            />
          </div>
        </>
      )}
      {draft.provider === "elasticsearch" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vector-semantic-field">semantic_text field</Label>
            <Input
              id="vector-semantic-field"
              className="h-11 font-mono"
              value={draft.semanticField ?? ""}
              maxLength={vectorDatabaseFormLimits.providerField.max}
              required
              aria-invalid={Boolean(semanticFieldError)}
              aria-describedby="vector-semantic-field-help"
              aria-errormessage={semanticFieldError ? "vector-semantic-field-help" : undefined}
              onBlur={() => touch("semanticField")}
              onChange={(event) => { touch("semanticField"); set("semanticField", event.target.value); }}
              placeholder="content_semantic"
            />
            <FieldFeedback
              id="vector-semantic-field-help"
              error={semanticFieldError}
              hint={`Required, up to ${vectorDatabaseFormLimits.providerField.max} characters.`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vector-content-field">Content field</Label>
            <Input
              id="vector-content-field"
              className="h-11 font-mono"
              value={draft.contentField ?? ""}
              maxLength={vectorDatabaseFormLimits.providerField.max}
              required
              aria-invalid={Boolean(contentFieldError)}
              aria-describedby="vector-content-field-help"
              aria-errormessage={contentFieldError ? "vector-content-field-help" : undefined}
              onBlur={() => touch("contentField")}
              onChange={(event) => { touch("contentField"); set("contentField", event.target.value); }}
              placeholder="content"
            />
            <FieldFeedback
              id="vector-content-field-help"
              error={contentFieldError}
              hint={`Required, up to ${vectorDatabaseFormLimits.providerField.max} characters.`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldFeedback({ id, error, hint, count }: {
  id: string;
  error: string;
  hint: string;
  count?: string;
}) {
  return (
    <p
      id={id}
      role={error ? "alert" : undefined}
      aria-live="polite"
      aria-atomic="true"
      className={`flex items-start justify-between gap-3 text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}
    >
      <span>{error || hint}</span>
      {count ? <span className="shrink-0 tabular-nums">{count}</span> : null}
    </p>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <span className="text-xs"><span className="block text-muted-foreground">{label}</span><strong className="mt-1 block">{value}</strong></span>;
}

function Notice({ children, tone }: { children: ReactNode; tone: "error" | "info" }) {
  return <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" : "border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm"}>{children}</p>;
}
