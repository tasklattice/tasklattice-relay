export const INSTANCE_COLUMNS_STORAGE_KEY = "tali.instances.hidden-columns.v2";

export const instanceListColumns = [
  { id: "source", label: "Source", track: "minmax(7rem,.7fr)" },
  { id: "runtime", label: "Runtime", track: "minmax(8rem,.9fr)" },
  { id: "version", label: "Active version", track: "minmax(7rem,.7fr)" },
  { id: "ownedBy", label: "Owned by", track: "minmax(8rem,.75fr)" },
  { id: "createdBy", label: "Created by", track: "minmax(8rem,.75fr)" },
  { id: "updatedAt", label: "Modified", track: "minmax(7.5rem,.65fr)" },
  { id: "status", label: "Status", track: "8rem" },
  { id: "access", label: "Access", track: "3.5rem" },
] as const;

export type InstanceListColumnId = (typeof instanceListColumns)[number]["id"];

const instanceListColumnIds = new Set<InstanceListColumnId>(
  instanceListColumns.map((column) => column.id),
);

export function parseHiddenInstanceColumns(value: string | null): InstanceListColumnId[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const requested = new Set(
      parsed.filter(
        (column): column is InstanceListColumnId =>
          typeof column === "string" &&
          instanceListColumnIds.has(column as InstanceListColumnId),
      ),
    );
    return instanceListColumns
      .map((column) => column.id)
      .filter((column) => requested.has(column));
  } catch {
    return [];
  }
}

export function toggleHiddenInstanceColumn(
  hiddenColumns: readonly InstanceListColumnId[],
  column: InstanceListColumnId,
): InstanceListColumnId[] {
  const next = new Set(hiddenColumns);
  if (next.has(column)) next.delete(column);
  else next.add(column);
  return instanceListColumns
    .map((item) => item.id)
    .filter((item) => next.has(item));
}

export function instanceListGridTemplate(
  hiddenColumns: readonly InstanceListColumnId[],
): string {
  const hidden = new Set(hiddenColumns);
  return [
    "minmax(13rem,1.3fr)",
    ...instanceListColumns
      .filter((column) => !hidden.has(column.id))
      .map((column) => column.track),
    "3rem",
  ].join(" ");
}
