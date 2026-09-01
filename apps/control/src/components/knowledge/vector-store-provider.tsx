import {
  type KnowledgeSourceDefinition,
  type ProviderKind,
} from "@tali/contracts";
import {
  siElasticsearch,
  siPostgresql,
  type SimpleIcon,
} from "simple-icons";
import { ProviderIcon } from "@/components/providers/provider-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type VectorStoreProvider = KnowledgeSourceDefinition["provider"];

export const vectorStoreProviders = [
  { id: "postgresql", label: "TaskLattice PostgreSQL", icon: siPostgresql, description: "Built-in PGVector with Docling ingestion" },
  { id: "openai", label: "OpenAI", presetId: "openai", description: "Hosted OpenAI Vector Store" },
  { id: "azure", label: "Azure OpenAI", presetId: "azure-openai", description: "Azure-hosted OpenAI Vector Store" },
  { id: "bedrock", label: "Amazon Bedrock", presetId: "aws-bedrock", description: "Bedrock managed vector retrieval" },
  { id: "vertex_ai", label: "Google Vertex AI", presetId: "vertex-ai", description: "Vertex AI RAG Engine" },
  { id: "pg_vector", label: "External PGVector", icon: siPostgresql, description: "LiteLLM PGVector connector service" },
  { id: "elasticsearch", label: "Elasticsearch", icon: siElasticsearch, description: "Native semantic_text vector search" },
] as const satisfies ReadonlyArray<{
  id: VectorStoreProvider;
  label: string;
  description: string;
  presetId?: ProviderKind;
  icon?: SimpleIcon;
}>;

export function getVectorStoreProvider(provider: VectorStoreProvider) {
  return vectorStoreProviders.find((item) => item.id === provider)
    ?? vectorStoreProviders[0];
}

export function VectorStoreProviderIcon({
  className,
  provider,
}: {
  className?: string;
  provider: VectorStoreProvider;
}) {
  const item = getVectorStoreProvider(provider);
  if ("icon" in item) {
    return (
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-md border border-border bg-card shadow-xs", className)}>
        <svg
          aria-hidden="true"
          className="size-6"
          role="img"
          style={{ color: `#${item.icon.hex}` }}
          viewBox="0 0 24 24"
        >
          <path d={item.icon.path} fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <ProviderIcon
      presetId={item.presetId}
      className={cn("size-10 [&_img]:size-6", className)}
    />
  );
}

export function VectorStoreProviderSelect({
  disabled,
  id,
  onValueChange,
  required = false,
  value,
}: {
  disabled?: boolean;
  id: string;
  onValueChange: (value: VectorStoreProvider) => void;
  required?: boolean;
  value: VectorStoreProvider;
}) {
  const selected = getVectorStoreProvider(value);
  return (
    <Select
      disabled={Boolean(disabled)}
      required={required}
      value={value}
      onValueChange={(next) => onValueChange(next as VectorStoreProvider)}
    >
      <SelectTrigger id={id} className="w-full data-[size=default]:h-11">
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2">
            <VectorStoreProviderIcon
              provider={selected.id}
              className="size-7 rounded-sm border-0 shadow-none [&_img]:size-5"
            />
            <span className="truncate">{selected.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {vectorStoreProviders.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <span className="flex items-center gap-2.5">
              <VectorStoreProviderIcon
                provider={item.id}
                className="size-8 rounded-sm shadow-none [&_img]:size-5"
              />
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
