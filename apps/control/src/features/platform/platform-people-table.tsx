import { useMemo } from "react";
import type { PlatformPersonView } from "@tali/contracts";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AccountAvatar } from "@/components/account/account-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { projectRoleLabels } from "@/types/project";

function AdministrationScopes({ person }: { person: PlatformPersonView }) {
  const scopes = [
    person.systemRole === "platform_administrator" ? "Platform Administrator" : null,
    person.departments.some(({ role }) => role === "administrator")
      ? "Department Administrator"
      : null,
    person.projects.some(({ roles }) => roles.includes("admin"))
      ? "Project Administrator"
      : null,
  ].filter((scope): scope is string => Boolean(scope));
  return scopes.length ? (
    <div className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => (
        <Badge key={scope} variant={scope === "Platform Administrator" ? "secondary" : "outline"}>
          {scope}
        </Badge>
      ))}
    </div>
  ) : <span className="text-xs text-muted-foreground">No administrative role</span>;
}

function AccessList({
  empty,
  items,
}: {
  empty: string;
  items: Array<{ detail: string; id: string; name: string }>;
}) {
  return items.length ? (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="min-w-0 text-xs leading-4">
          <span className="block truncate font-medium" title={item.name}>{item.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground" title={item.detail}>
            {item.detail}
          </span>
        </li>
      ))}
    </ul>
  ) : <span className="text-xs text-muted-foreground">{empty}</span>;
}

export function PlatformPeopleTable({
  isFetching,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  people,
  total,
  totalPages,
}: {
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  people: readonly PlatformPersonView[];
  total: number;
  totalPages: number;
}) {
  const columns = useMemo<ColumnDef<PlatformPersonView>[]>(() => [
    {
      id: "person",
      header: "Person",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <AccountAvatar
            identity={{
              displayName: row.original.displayName,
              email: row.original.email,
            }}
            className="size-9 shrink-0"
          />
          <span className="min-w-0">
            <strong className="block truncate text-sm">{row.original.displayName}</strong>
            <span className="block truncate text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </span>
        </div>
      ),
    },
    {
      id: "administrativeScope",
      header: "Administrative scope",
      cell: ({ row }) => <AdministrationScopes person={row.original} />,
    },
    {
      id: "departments",
      header: "Departments",
      cell: ({ row }) => (
        <AccessList
          empty="No Department assignment"
          items={row.original.departments.map((department) => ({
            id: department.id,
            name: department.name,
            detail: department.role === "administrator"
              ? "Department Administrator"
              : "Department Member",
          }))}
        />
      ),
    },
    {
      id: "projects",
      header: "Projects",
      cell: ({ row }) => (
        <AccessList
          empty="No Project membership"
          items={row.original.projects.map((project) => ({
            id: project.id,
            name: project.name,
            detail: `${project.departmentName} · ${project.roles.map((role) => projectRoleLabels[role]).join(", ")}`,
          }))}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={row.original.status === "active"
            ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
            : "border-destructive/25 text-destructive"}
        >
          {row.original.status}
        </Badge>
      ),
    },
  ], []);
  const data = useMemo(() => [...people], [people]);
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (person) => person.id,
    manualPagination: true,
    pageCount: totalPages,
    state: {
      pagination: { pageIndex: page - 1, pageSize },
    },
  });
  const firstVisible = total ? (page - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(page * pageSize, total);

  return (
    <div className="border-y">
      <div className="relative overflow-x-auto">
        <table aria-label="Platform people and administrative access" className="w-full min-w-[72rem] table-fixed text-left">
          <colgroup>
            <col className="w-[18rem]" />
            <col className="w-[17rem]" />
            <col className="w-[17rem]" />
            <col />
            <col className="w-[7rem]" />
          </colgroup>
          <thead className="border-b bg-muted/20 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="h-10 px-4 font-medium">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-muted/20">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!people.length ? (
              <tr>
                <td colSpan={columns.length} className="h-32 px-4 text-center text-sm text-muted-foreground">
                  No people match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex min-h-14 flex-col gap-3 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span aria-live="polite">
          Showing {firstVisible}–{lastVisible} of {total} people
          {isFetching ? " · Updating…" : ""}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger className="h-11 w-20" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="min-w-20 text-center">Page {page} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={page <= 1 || isFetching}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft /> Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={page >= totalPages || isFetching}
              onClick={() => onPageChange(page + 1)}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
