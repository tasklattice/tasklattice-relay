import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ProviderFormSection({ children, description, title }: { children: ReactNode; description?: string; title: string }) {
  return (
    <fieldset className="space-y-4 border bg-muted/10 p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {children}
    </fieldset>
  );
}

export function ProviderTextField({ disabled, error, id, label, onChange, placeholder, required = false, type = "text", value }: {
  disabled: boolean;
  error?: string | undefined;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  required?: boolean;
  type?: "password" | "text" | "url";
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} required={required}>{label}</Label>
      <Input id={id} type={type} value={value} disabled={disabled} required={required} placeholder={placeholder} aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      {error ? <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ProviderSelectField({ disabled, id, label, onChange, options, required = false, value }: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  required?: boolean;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} required={required}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled} required={required}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export function ProviderTextareaField({ disabled, error, id, label, onChange, placeholder, required = false, value }: {
  disabled: boolean;
  error?: string | undefined;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  required?: boolean;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} required={required}>{label}</Label>
      <Textarea id={id} rows={7} value={value} disabled={disabled} required={required} placeholder={placeholder} aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      {error ? <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
