import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function ListToolbar({ children, count, onSearchChange, search, searchLabel }: {
  children?: ReactNode;
  count: number;
  onSearchChange: (value: string) => void;
  search: string;
  searchLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
      <div className="relative min-w-0 flex-[1_1_16rem] sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label={searchLabel} placeholder={searchLabel} value={search} onChange={(event) => onSearchChange(event.target.value)} className="pl-9" />
      </div>
      {children}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground" role="status">{count} {count === 1 ? "result" : "results"}</span>
    </div>
  );
}
