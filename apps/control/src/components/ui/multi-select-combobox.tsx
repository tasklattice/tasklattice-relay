"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import {
  filterMultiSelectOptions,
  isMultiSelectOptionDisabled,
  type MultiSelectOption,
} from "@/components/ui/multi-select-options";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type MultiSelectComboboxProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
  maxSelected?: number;
  noOptionsMessage?: string;
  onValueChange: (value: string[]) => void;
  options: readonly MultiSelectOption[];
  placeholder?: string;
  required?: boolean;
  searchPlaceholder?: string;
  value: readonly string[];
};

export type { MultiSelectOption } from "@/components/ui/multi-select-options";

export function MultiSelectCombobox({
  ariaLabel,
  className,
  disabled = false,
  emptyMessage = "No options start with",
  id,
  maxSelected,
  noOptionsMessage = "No options are available in this Project.",
  onValueChange,
  options,
  placeholder = "Select options…",
  required = false,
  searchPlaceholder = "Filter by name…",
  value,
}: MultiSelectComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredOptions = filterMultiSelectOptions(options, query);
  const selectedOptions = value
    .map((selectedValue) =>
      options.find((option) => option.value === selectedValue),
    )
    .filter((option): option is MultiSelectOption => Boolean(option));
  const activeOption = filteredOptions[activeIndex];
  const selectionLimitReached =
    maxSelected !== undefined && value.length >= maxSelected;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const focusInput = () => inputRef.current?.focus();
  const openOptions = () => {
    if (disabled) return;
    setOpen(true);
    focusInput();
  };
  const toggleOption = (option: MultiSelectOption) => {
    if (isMultiSelectOptionDisabled(option, value, maxSelected)) return;
    const nextValue = value.includes(option.value)
      ? value.filter((selectedValue) => selectedValue !== option.value)
      : [...value, option.value];
    onValueChange(nextValue);
    setQuery("");
    setOpen(true);
  };
  const removeOption = (optionValue: string) => {
    onValueChange(value.filter((selectedValue) => selectedValue !== optionValue));
    setOpen(true);
    focusInput();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!filteredOptions.length) return;
      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + filteredOptions.length) % filteredOptions.length;
      });
      return;
    }
    if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      toggleOption(activeOption);
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && !query && value.length) {
      const lastValue = value.at(-1);
      if (lastValue) removeOption(lastValue);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex min-h-12 w-full cursor-text flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2.5 py-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
            disabled && "cursor-not-allowed bg-input/50 opacity-50",
            className,
          )}
          onClick={openOptions}
        >
          {selectedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={`Remove ${option.label}`}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-sm border border-primary/30 bg-primary/10 pl-3 pr-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2"
              onClick={(event) => {
                event.stopPropagation();
                removeOption(option.value);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="truncate">{option.label}</span>
              <X className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-activedescendant={
              open && activeOption ? `${listboxId}-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            aria-required={required}
            autoComplete="off"
            className="h-8 min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={selectedOptions.length ? searchPlaceholder : placeholder}
            value={query}
          />
          <button
            type="button"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            aria-label={`${open ? "Close" : "Open"} options for ${ariaLabel}`}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 disabled:cursor-not-allowed"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (open) setOpen(false);
              else openOptions();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={10}
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <Search className="size-4 shrink-0" />
          <span aria-live="polite" className="min-w-0 flex-1">
            {selectionLimitReached
              ? `${value.length} selected · maximum ${maxSelected}`
              : query
              ? `${filteredOptions.length} matching ${filteredOptions.length === 1 ? "option" : "options"}`
              : `${options.length} available ${options.length === 1 ? "option" : "options"}`}
          </span>
          {value.length ? (
            <button
              type="button"
              className="min-h-8 shrink-0 px-2 font-medium text-foreground hover:text-primary focus-visible:outline-2"
              onClick={() => { onValueChange([]); setQuery(""); focusInput(); }}
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} options`}
          aria-multiselectable="true"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
        >
          {filteredOptions.length ? (
            filteredOptions.map((option, index) => {
              const selected = value.includes(option.value);
              const active = index === activeIndex;
              const optionDisabled = isMultiSelectOptionDisabled(
                option,
                value,
                maxSelected,
              );
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-disabled={optionDisabled || undefined}
                  aria-selected={selected}
                  disabled={optionDisabled}
                  className={cn(
                    "grid min-h-16 w-full grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 rounded-sm px-3 py-2.5 text-left outline-hidden transition-colors",
                    selected && "bg-primary/5 text-foreground",
                    active && !selected && "bg-accent text-accent-foreground",
                    active && selected && "bg-primary/10",
                    optionDisabled && "cursor-not-allowed opacity-50",
                  )}
                  onClick={() => toggleOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 place-items-center rounded-sm border",
                      selected && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {selected ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline justify-between gap-3">
                      <strong className="truncate text-sm font-medium">{option.label}</strong>
                      {option.meta ? (
                        <span className={cn(
                          "inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground",
                          option.metaTone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                          option.metaTone === "warning" && "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                          option.metaTone === "danger" && "bg-destructive/10 text-destructive",
                        )}>
                          {option.metaTone ? <span className={cn(
                            "size-1.5 rounded-full bg-current",
                            option.metaTone === "success" && "bg-emerald-500",
                            option.metaTone === "warning" && "bg-amber-500",
                            option.metaTone === "danger" && "bg-destructive",
                          )} /> : null}
                          {option.meta}
                        </span>
                      ) : null}
                    </span>
                    {option.description ? (
                      <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center">
              <strong className="block text-sm">
                {query.trim()
                  ? `${emptyMessage} “${query.trim()}”`
                  : noOptionsMessage}
              </strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {query.trim()
                  ? "Clear the input to browse every available option."
                  : "Create or connect one before selecting it."}
              </span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
