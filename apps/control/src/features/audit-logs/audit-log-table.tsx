import { Fragment, useMemo } from "react";
import type {
  PlatformAuditLogEvent,
  PlatformAuditSortDirection,
} from "@tali/contracts";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { AuditLogDetailPanel } from "./audit-log-detail-panel";
import { AuditLogOutcomeMark } from "./audit-log-outcome-mark";
import { titleCase } from "./audit-log-utils";

export function AuditLogTable({
  direction,
  events,
  onClose,
  onDirectionChange,
  onSelect,
  selectedEventId,
}: {
  direction: PlatformAuditSortDirection;
  events: readonly PlatformAuditLogEvent[];
  onClose: () => void;
  onDirectionChange: (direction: PlatformAuditSortDirection) => void;
  onSelect: (event: PlatformAuditLogEvent) => void;
  selectedEventId: string | undefined;
}) {
  const columns = useMemo<ColumnDef<PlatformAuditLogEvent>[]>(
    () => [
      {
        accessorKey: "occurredAt",
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={column.getToggleSortingHandler()}
              aria-label={`Sort audit logs ${sorted === "desc" ? "oldest first" : "newest first"}`}
            >
              Time
              {sorted === "desc"
                ? <ArrowDown className="size-3" />
                : sorted === "asc"
                  ? <ArrowUp className="size-3" />
                  : <ChevronsUpDown className="size-3" />}
            </button>
          );
        },
        cell: ({ row }) => (
          <time
            dateTime={row.original.occurredAt}
            className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {formatPlatformDateTime(row.original.occurredAt, {
              dateStyle: "short",
              timeStyle: "medium",
            })}
          </time>
        ),
      },
      {
        id: "actor",
        header: "Authorized actor",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block truncate text-[11px] font-medium"
            title={row.original.actor.email ?? titleCase(row.original.actor.type)}
          >
            {row.original.actor.name}
          </span>
        ),
      },
      {
        accessorKey: "verb",
        header: "Verb",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block truncate font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-link"
            title={row.original.action}
          >
            {row.original.verb}
          </span>
        ),
      },
      {
        id: "object",
        header: "Object",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block min-w-0 truncate text-[11px]">
            <span className="text-muted-foreground">
              {row.original.object.type}
              <span className="mx-1.5 text-border">/</span>
            </span>
            <span className="font-medium">{row.original.object.name}</span>
          </span>
        ),
      },
      {
        accessorKey: "outcome",
        header: "Result",
        enableSorting: false,
        cell: ({ row }) => (
          <AuditLogOutcomeMark outcome={row.original.outcome} />
        ),
      },
      {
        id: "details",
        header: () => <span className="sr-only">Details</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const selected = row.original.id === selectedEventId;
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(row.original);
              }}
              aria-controls={`audit-event-details-${row.original.id}-desktop`}
              aria-expanded={selected}
              aria-label={`${selected ? "Close" : "Open"} audit details: ${row.original.summary}`}
            >
              <ChevronRight
                className={selected ? "rotate-90 transition-transform" : "transition-transform"}
              />
            </Button>
          );
        },
      },
    ],
    [onSelect, selectedEventId],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: "occurredAt", desc: direction === "desc" }],
    [direction],
  );
  const onSortingChange = (updater: Updater<SortingState>) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    onDirectionChange(next[0]?.desc === false ? "asc" : "desc");
  };
  // TanStack Table treats a new data reference as a real data update.
  // Keep it stable across selection renders so row-model resets cannot loop.
  const data = useMemo(() => [...events], [events]);
  const table = useReactTable({
    autoResetPageIndex: false,
    columns,
    data,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (event) => event.id,
    manualPagination: true,
    manualSorting: true,
    onSortingChange,
    state: { sorting },
  });

  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full table-fixed text-left">
        <colgroup>
          <col className="w-[10.5rem]" />
          <col className="w-[23%]" />
          <col className="w-[7.25rem]" />
          <col />
          <col className="w-[5.5rem]" />
          <col className="w-10" />
        </colgroup>
        <thead className="border-b bg-muted/20 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="h-8 px-4 font-medium first:pr-1 last:px-1">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y">
          {table.getRowModel().rows.map((row) => {
            const selected = row.original.id === selectedEventId;
            return (
              <Fragment key={row.id}>
                <tr
                  className={selected
                    ? "group cursor-pointer bg-muted/25 transition-colors"
                    : "group cursor-pointer transition-colors hover:bg-muted/25"}
                  onClick={() => onSelect(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="h-11 px-4 first:pr-1 last:px-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {selected ? (
                  <tr>
                    <td colSpan={columns.length} className="p-0">
                      <AuditLogDetailPanel
                        event={row.original}
                        id={`audit-event-details-${row.original.id}-desktop`}
                        onClose={onClose}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
