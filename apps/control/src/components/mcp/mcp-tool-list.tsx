import type { McpToolDefinition } from "@tali/contracts";
import { Braces, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function annotationLabels(tool: McpToolDefinition): string[] {
  const labels: string[] = [];
  if (tool.annotations?.readOnlyHint) labels.push("Read only");
  if (tool.annotations?.destructiveHint) labels.push("Destructive");
  if (tool.annotations?.idempotentHint) labels.push("Idempotent");
  if (tool.annotations?.openWorldHint) labels.push("Open world");
  return labels;
}

function parameterSummary(tool: McpToolDefinition): string {
  const properties = tool.inputSchema.properties;
  const count = properties && typeof properties === "object"
    ? Object.keys(properties as Record<string, unknown>).length
    : 0;
  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.length
    : 0;
  if (!count) return "No declared parameters";
  return `${count} parameter${count === 1 ? "" : "s"} · ${required} required`;
}

export function McpToolList({ tools }: { tools: readonly McpToolDefinition[] }) {
  if (!tools.length) {
    return (
      <div className="border-y px-4 py-10 text-center">
        <Braces className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No tools discovered</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Run discovery after the server and its credential are reachable.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y border-y">
      {tools.map((tool) => {
        const labels = annotationLabels(tool);
        return (
          <article key={tool.name} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {tool.title ? (
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{tool.title}</p>
                ) : null}
                <code className="inline-block max-w-full break-all bg-primary/10 px-2 py-1 font-mono text-xs font-semibold text-link">
                  {tool.name}
                </code>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {tool.annotations?.destructiveHint
                  ? <ShieldAlert className="size-3.5 text-amber-600" />
                  : <ShieldCheck className="size-3.5 text-emerald-600" />}
                {parameterSummary(tool)}
              </span>
            </div>
            {tool.description ? (
              <p className="mt-2 text-sm leading-5 text-muted-foreground">{tool.description}</p>
            ) : null}
            {labels.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <Badge key={label} variant={label === "Destructive" ? "destructive" : "outline"}>
                    {label}
                  </Badge>
                ))}
              </div>
            ) : null}
            <details className="group mt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Input schema
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto border bg-muted/40 p-3 text-[11px] leading-5">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </details>
          </article>
        );
      })}
    </div>
  );
}
