import { useMemo, useState } from "react";
import type { McpServerTemplate } from "@tali/contracts";
import {
  ArrowRight,
  PackageCheck,
  PlugZap,
  Search,
  ServerCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { McpBrandIcon } from "./mcp-brand-icon";

export function McpTemplateCatalog({
  onCustom,
  onSelect,
  templates,
}: {
  onCustom: () => void;
  onSelect: (template: McpServerTemplate) => void;
  templates: McpServerTemplate[];
}) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const categories = ["All", ...new Set(templates.map((template) => template.category))];
  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = templates.filter((template) =>
      (category === "All" || template.category === category)
      && (!query || `${template.name} ${template.description}`.toLowerCase().includes(query)));
    const groups = new Map<string, McpServerTemplate[]>();
    for (const template of visible) {
      groups.set(template.category, [...(groups.get(template.category) ?? []), template]);
    }
    return [...groups.entries()];
  }, [category, search, templates]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><PlugZap className="size-4 text-primary" /> Curated integrations</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Pick a reviewed starting point. Registration still creates a private LiteLLM MCP Server for this Project.
          </p>
        </div>
        <Button className="h-11" variant="outline" onClick={onCustom}><ServerCog /> Custom server</Button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="MCP categories">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            aria-pressed={item === category}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
              item === category ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-foreground/20 hover:bg-muted/70",
            )}
          >
            {item}
            <span className={cn(
              "tabular-nums opacity-65",
              item === category ? "text-primary-foreground" : "text-muted-foreground",
            )}>
              {item === "All" ? templates.length : templates.filter((template) => template.category === item).length}
            </span>
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search built-in MCP servers"
        />
      </div>
      <div className="space-y-5">
        {grouped.map(([group, items]) => (
          <section key={group}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group}</p>
              <span className="text-[10px] tabular-nums text-muted-foreground">{items.length} integrations</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onSelect(template)}
                    className={cn(
                      "group relative flex min-h-36 items-start gap-4 overflow-hidden rounded-lg border bg-card p-4 text-left shadow-xs transition-[border-color,background-color,box-shadow,transform] duration-200",
                      "hover:border-primary/30 hover:bg-accent/30",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    )}
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-md border bg-background shadow-xs transition-transform duration-200 group-hover:scale-[1.03]">
                      <McpBrandIcon brand={template.logo} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col self-stretch">
                      <span className="flex min-h-7 flex-wrap items-start gap-2">
                        <strong className="text-sm leading-6">{template.name}</strong>
                        <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-primary/8 px-2 text-[9px] font-semibold uppercase tracking-wide text-primary">
                          <PackageCheck className="size-3" /> Built-in
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</span>
                      <span className="mt-auto flex items-center justify-between gap-3 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span>{transportLabel(template.transport)}</span>
                        <span className="flex items-center gap-1 text-foreground/70 transition-colors group-hover:text-primary">
                          Configure <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </span>
                    </span>
                  </button>
              ))}
            </div>
          </section>
        ))}
        {!grouped.length ? (
          <div className="border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
            No built-in MCP server matches this filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function transportLabel(transport: McpServerTemplate["transport"]): string {
  if (transport === "http") return "Streamable HTTP";
  if (transport === "sse") return "SSE";
  if (transport === "stdio") return "Reviewed stdio";
  return "OpenAPI";
}
