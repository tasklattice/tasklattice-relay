import { useEffect, useMemo, useState } from "react";
import type { CostBreakdownItem, CostGroupBy } from "@tali/contracts";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { compactNumber, costGroupLabels, usd } from "./cost-utils";

type SortDirection = "asc" | "desc";
type Column = {
  id: string;
  label: string;
  numeric?: boolean;
  value: (item: CostBreakdownItem) => string | number;
  render?: (item: CostBreakdownItem) => React.ReactNode;
};

const avg = (item: CostBreakdownItem) => item.requests ? item.spend / item.requests : 0;
const tokens = (item: CostBreakdownItem) => item.inputTokens + item.outputTokens;
const baseName = (label: string): Column => ({
  id: "label",
  label,
  value: (item) => item.label,
  render: (item) => (
    <span className="block max-w-64">
      <strong className="block truncate font-medium">{item.label}</strong>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.detail}</span>
    </span>
  ),
});
const spend: Column = { id: "spend", label: "Spend", numeric: true, value: (item) => item.spend, render: (item) => usd(item.spend) };
const requests: Column = { id: "requests", label: "Requests", numeric: true, value: (item) => item.requests, render: (item) => compactNumber(item.requests) };
const inputTokens: Column = { id: "inputTokens", label: "Input tokens", numeric: true, value: (item) => item.inputTokens, render: (item) => compactNumber(item.inputTokens) };
const outputTokens: Column = { id: "outputTokens", label: "Output tokens", numeric: true, value: (item) => item.outputTokens, render: (item) => compactNumber(item.outputTokens) };
const totalTokens: Column = { id: "totalTokens", label: "Total tokens", numeric: true, value: tokens, render: (item) => compactNumber(tokens(item)) };
const average: Column = { id: "average", label: "Average cost/request", numeric: true, value: avg, render: (item) => usd(avg(item)) };
const formatLastActive = (value: string | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
};
const lastActive: Column = { id: "lastActive", label: "Last active", value: (item) => item.lastActive ?? "", render: (item) => formatLastActive(item.lastActive) };

const columns: Record<CostGroupBy, Column[]> = {
  instance: [baseName("Instance"), spend, inputTokens, outputTokens, totalTokens, requests, average, lastActive],
  model_endpoint: [
    baseName("Model endpoint"),
    { id: "provider", label: "Provider", value: (item) => item.provider ?? "", render: (item) => item.provider || "—" },
    { id: "providerAccount", label: "Provider", value: (item) => item.providerAccount ?? "", render: (item) => item.providerAccount || "—" },
    spend,
    inputTokens,
    outputTokens,
    requests,
    average,
  ],
  provider_account: [
    baseName("Provider"),
    { id: "provider", label: "Provider type", value: (item) => item.provider ?? "", render: (item) => item.provider || "—" },
    spend,
    { id: "modelsUsed", label: "Models used", numeric: true, value: (item) => item.modelsUsed ?? 0 },
    totalTokens,
    requests,
    { id: "share", label: "Share", numeric: true, value: (item) => item.share, render: (item) => `${(item.share * 100).toFixed(1)}%` },
  ],
  virtual_key: [
    baseName("Virtual key alias"),
    { id: "boundInstance", label: "Bound Instance", value: (item) => item.boundInstance ?? "", render: (item) => item.boundInstance || "—" },
    { id: "user", label: "User", value: (item) => item.user ?? "", render: (item) => item.user || "—" },
    { id: "team", label: "Team", value: (item) => item.team ?? "", render: (item) => item.team || "—" },
    spend,
    totalTokens,
    requests,
    lastActive,
  ],
};

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(items: CostBreakdownItem[], tableColumns: Column[], groupBy: CostGroupBy) {
  const csv = [
    tableColumns.map((column) => escapeCsv(column.label)).join(","),
    ...items.map((item) => tableColumns.map((column) => escapeCsv(column.value(item))).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `model-cost-by-${groupBy}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CostBreakdownTable({
  groupBy,
  items,
  onRowClick,
}: {
  groupBy: CostGroupBy;
  items: CostBreakdownItem[];
  onRowClick: (item: CostBreakdownItem) => void;
}) {
  const tableColumns = columns[groupBy];
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState("spend");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = !needle ? items : items.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(needle));
    const column = tableColumns.find((item) => item.id === sortId) ?? spend;
    return [...result].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      const order = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
      return direction === "asc" ? order : -order;
    });
  }, [direction, items, query, sortId, tableColumns]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query, groupBy]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const toggleSort = (id: string) => {
    if (sortId === id) setDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSortId(id);
      setDirection(id === "label" ? "asc" : "desc");
    }
  };

  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="flex flex-col items-stretch justify-between gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
        <div>
          <CardTitle className="font-sans text-sm font-medium">Cost breakdown</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Detailed USD usage by {costGroupLabels[groupBy]}.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={`Search ${costGroupLabels[groupBy]}s`} className="h-8 pl-8 text-xs" placeholder="Search by name…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => downloadCsv(filtered, tableColumns, groupBy)}><Download />CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="border-b bg-muted/25 text-muted-foreground">
              <tr>
                {tableColumns.map((column) => {
                  const active = sortId === column.id;
                  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th key={column.id} className={column.numeric ? "px-3 text-right font-medium" : "px-3 font-medium"}>
                      <button type="button" className="inline-flex min-h-10 items-center gap-1 hover:text-foreground focus-visible:outline-2" onClick={() => toggleSort(column.id)}>
                        {column.label}<Icon className="size-3" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  className="cursor-pointer transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-2 focus-visible:outline-inset"
                  onClick={() => onRowClick(item)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(item); } }}
                >
                  {tableColumns.map((column) => (
                    <td key={column.id} className={column.numeric ? "px-3 py-2.5 text-right tabular-nums" : "px-3 py-2.5"}>
                      {column.render ? column.render(item) : column.value(item)}
                    </td>
                  ))}
                </tr>
              ))}
              {!visible.length ? (
                <tr><td colSpan={tableColumns.length} className="h-28 text-center text-sm text-muted-foreground">{items.length ? "No names match your search." : "No spend in this period"}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="flex items-center gap-2">
            <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></Button>
            <span>Page {page} of {pageCount}</span>
            <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
