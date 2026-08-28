import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  createVectorDatabaseDefinitionSchema,
  hasValidatedEmbeddingModel,
  type CreateVectorDatabaseDefinitionInput,
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

  const create = useMutation({
    mutationFn: api.createVectorDatabase,
    onSuccess: async (database) => {
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
      setFormOpen(false);
      setDraft(emptyDraft);
      await navigate({
        to: "/$projectId/vector-databases/$databaseId",
        params: { projectId, databaseId: database.id },
      });
    },
  });

  const submit = () => {
    if (!embeddingModelReady) {
      setFormError("Configure a validated embedding model before creating a Vector Database.");
      return;
    }
    const parsed = createVectorDatabaseDefinitionSchema.safeParse({
      ...draft,
      apiBase: draft.apiBase || undefined,
      embeddingModel: draft.embeddingModel || undefined,
      semanticField: draft.semanticField || undefined,
      contentField: draft.contentField || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Review the Vector Database configuration.");
      return;
    }
    setFormError("");
    create.mutate(parsed.data);
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
            onClick={() => { setDraft(emptyDraft); setFormError(""); create.reset(); setFormOpen(true); }}
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
          draft={draft}
          embeddingModels={embeddingModels}
          onChange={setDraft}
        />
        {formError || create.error ? <div className="mt-4"><Notice tone="error">{formError || create.error?.message}</Notice></div> : null}
      </EntitySheet>
    </div>
  );
}

function VectorDatabaseForm({ draft, embeddingModels, onChange }: {
  draft: CreateVectorDatabaseDefinitionInput;
  embeddingModels: Array<{ id: string; displayName: string; litellmModelName: string }>;
  onChange: (next: CreateVectorDatabaseDefinitionInput) => void;
}) {
  const set = <K extends keyof CreateVectorDatabaseDefinitionInput>(key: K, value: CreateVectorDatabaseDefinitionInput[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="vector-name">Name</Label><Input id="vector-name" className="h-11" value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="Engineering Research" /></div>
      <div className="space-y-2"><Label htmlFor="vector-description">Description</Label><Input id="vector-description" className="h-11" value={draft.description} onChange={(event) => set("description", event.target.value)} placeholder="Research documents used by Project Agents." /></div>
      <div className="space-y-2"><Label htmlFor="vector-provider">Provider</Label><VectorStoreProviderSelect id="vector-provider" value={draft.provider} onValueChange={(provider) => onChange({ ...draft, provider, embeddingModelDeploymentId: undefined, embeddingModel: undefined, embeddingDimensions: undefined })} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="vector-id">Vector Database ID</Label><Input id="vector-id" className="h-11 font-mono" value={draft.vectorStoreId} onChange={(event) => set("vectorStoreId", event.target.value)} placeholder={draft.provider === "postgresql" ? "engineering-research" : "vs_..."} /></div>
        <div className="space-y-2"><Label htmlFor="vector-top-k">Default Top K</Label><Input id="vector-top-k" className="h-11" type="number" min={1} max={50} value={draft.topK} onChange={(event) => set("topK", Number(event.target.value))} /></div>
      </div>

      {draft.provider === "postgresql" ? (
        <div className="space-y-3 border bg-muted/20 p-4">
          <div><strong className="text-sm">Built-in foundation</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Documents are parsed by Docling, embedded through the selected Project model, and stored in Project-isolated PGVector.</p></div>
          <div className="space-y-2">
            <Label htmlFor="vector-embedding">Embedding model</Label>
            <Select value={draft.embeddingModelDeploymentId ?? ""} onValueChange={(id) => {
              const model = embeddingModels.find((item) => item.id === id);
              onChange({ ...draft, embeddingModelDeploymentId: id, embeddingModel: model?.litellmModelName, embeddingDimensions: undefined });
            }}>
              <SelectTrigger id="vector-embedding" size="lg" className="w-full"><SelectValue placeholder="Select a validated embedding model" /></SelectTrigger>
              <SelectContent>{embeddingModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}<span className="ml-2 font-mono text-xs text-muted-foreground">{model.litellmModelName}</span></SelectItem>)}</SelectContent>
            </Select>
            {!embeddingModels.length ? <p className="text-xs text-amber-700 dark:text-amber-300">Create and validate a text-embedding model before using built-in storage.</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2"><Label htmlFor="vector-api-base">Provider API base</Label><Input id="vector-api-base" className="h-11 font-mono" value={draft.apiBase ?? ""} onChange={(event) => set("apiBase", event.target.value)} placeholder="https://vector.example.com" /></div>
          <div className="space-y-2"><Label htmlFor="vector-credential">Credential reference</Label><Input id="vector-credential" className="h-11 font-mono" value={draft.credentialReference} onChange={(event) => set("credentialReference", event.target.value)} placeholder="secret://project/vector-provider" /></div>
        </>
      )}
      {draft.provider === "elasticsearch" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="vector-semantic-field">semantic_text field</Label><Input id="vector-semantic-field" className="h-11 font-mono" value={draft.semanticField ?? ""} onChange={(event) => set("semanticField", event.target.value)} placeholder="content_semantic" /></div>
          <div className="space-y-2"><Label htmlFor="vector-content-field">Content field</Label><Input id="vector-content-field" className="h-11 font-mono" value={draft.contentField ?? ""} onChange={(event) => set("contentField", event.target.value)} placeholder="content" /></div>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <span className="text-xs"><span className="block text-muted-foreground">{label}</span><strong className="mt-1 block">{value}</strong></span>;
}

function Notice({ children, tone }: { children: ReactNode; tone: "error" | "info" }) {
  return <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" : "border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm"}>{children}</p>;
}
