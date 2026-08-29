import { useEffect, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export function SystemPromptViewer({ defaultPrompt, onApply, onOpenChange, open, presetName, prompt }: {
  defaultPrompt: string;
  onApply: (prompt: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  prompt: string;
  presetName: string;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(prompt);
  const isValid = draft.trim().length >= 10;
  const isDefault = draft === defaultPrompt;
  const isChanged = draft !== prompt;

  useEffect(() => {
    if (open) setDraft(prompt);
  }, [open, prompt]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setCopied(false); }}>
      <SheetContent side="right" className="w-[min(92vw,38rem)] sm:max-w-[38rem]">
        <SheetHeader className="border-b px-6 py-5 pr-14">
          <SheetTitle className="text-xl">{presetName} instructions</SheetTitle>
          <SheetDescription>Edit these instructions for this Instance only. The Toolbox preset and future Instances remain unchanged.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="instance-system-prompt">Prompt</Label>
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyPrompt()}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Textarea
            id="instance-system-prompt"
            aria-invalid={!isValid}
            className="min-h-64 resize-y font-mono text-xs leading-6"
            maxLength={8000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-start justify-between gap-4 text-xs">
            <span className={isValid ? "text-muted-foreground" : "text-destructive"}>
              {isValid ? (isDefault ? "Using the Toolbox preset." : "Customized for this Instance.") : "Enter at least 10 characters."}
            </span>
            <span className="shrink-0 text-muted-foreground">{draft.length}/8000</span>
          </div>
        </div>
        <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <SheetClose asChild><Button variant="outline">Cancel</Button></SheetClose>
          <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button type="button" variant="ghost" disabled={isDefault} onClick={() => setDraft(defaultPrompt)}>
              <RotateCcw /> Use preset instructions
            </Button>
            <Button
              type="button"
              disabled={!isValid || !isChanged}
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
            >
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
