import { useState } from "react";
import type {
  CostFilterKey,
  CostFilterOption,
  CostFilters,
} from "@tali/contracts";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { costFilterLabels } from "./cost-utils";

const filterKeys: CostFilterKey[] = [
  "work", "task",
  "instance",
  "model_endpoint",
  "provider",
  "provider_account",
  "virtual_key",
  "project",
];

function selectedCount(filters: CostFilters): number {
  return Object.values(filters).reduce((sum, values) => sum + (values?.length ?? 0), 0);
}

export function CostFilterBar({
  filters,
  options,
  onChange,
}: {
  filters: CostFilters;
  options: Record<CostFilterKey, CostFilterOption[]>;
  onChange: (filters: CostFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selectedCount(filters);
  const labelFor = (key: CostFilterKey, value: string) =>
    options[key].find((option) => option.value === value)?.label ?? value;
  const setFilter = (key: CostFilterKey, values: string[]) =>
    onChange({ ...filters, [key]: values.length ? values : undefined });
  const chips = filterKeys.flatMap((key) =>
    (filters[key] ?? []).map((value) => ({ key, value, label: labelFor(key, value) })),
  );
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" aria-label="Open cost filters" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Filter />
        Filters
        {count ? <span className="grid size-4 place-items-center rounded-full bg-foreground text-[10px] text-background">{count}</span> : null}
      </Button>
      {open ? (
        <div role="dialog" aria-label="Cost filters" className="absolute right-0 top-10 z-40 w-[min(44rem,calc(100vw-2rem))] rounded-md border bg-popover p-4 text-popover-foreground shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Filter cost activity</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Selections combine across categories.</p>
            </div>
            <div className="flex items-center gap-1">
              {count ? <Button variant="ghost" size="sm" onClick={() => onChange({})}>Clear all</Button> : null}
              <Button variant="ghost" size="icon-sm" aria-label="Close cost filters" onClick={() => setOpen(false)}><X /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {filterKeys.map((key) => (
              <label key={key} className="grid gap-1.5 text-xs font-medium">
                {costFilterLabels[key]}
                <MultiSelectCombobox
                  ariaLabel={`Filter by ${costFilterLabels[key]}`}
                  className="min-h-10 bg-background py-1"
                  emptyMessage="No matching options"
                  options={options[key]}
                  placeholder={`All ${costFilterLabels[key].toLowerCase()}s`}
                  value={filters[key] ?? []}
                  onValueChange={(values) => setFilter(key, values)}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {chips.map((chip) => (
        <button
          type="button"
          key={`${chip.key}-${chip.value}`}
          className="inline-flex h-8 max-w-64 items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 text-xs transition-colors hover:bg-muted focus-visible:outline-2"
          onClick={() => setFilter(chip.key, (filters[chip.key] ?? []).filter((value) => value !== chip.value))}
          aria-label={`Remove ${costFilterLabels[chip.key]} filter ${chip.label}`}
        >
          <span className="text-muted-foreground">{costFilterLabels[chip.key]}:</span>
          <span className="truncate font-medium">{chip.label}</span>
          <X className="size-3 shrink-0 text-muted-foreground" />
        </button>
      ))}
      {count > 1 ? <Button variant="ghost" size="sm" onClick={() => onChange({})}>Clear all</Button> : null}
    </div>
  );
}
