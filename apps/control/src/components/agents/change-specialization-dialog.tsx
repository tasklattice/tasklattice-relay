import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function ChangeList({ empty, items, label }: { empty: string; items: readonly string[]; label: string }) {
  return (
    <section className="rounded-md border p-4">
      <h3 className="text-xs font-semibold text-muted-foreground">{label}</h3>
      {items.length ? <ul className="mt-2 space-y-1.5 text-sm">{items.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{empty}</p>}
    </section>
  );
}

export function ChangeToolboxPresetDialog({ add, fromName, instructionsCustomized, keep, onCancel, onConfirm, open, remove, toName }: {
  add: readonly string[];
  fromName: string;
  instructionsCustomized: boolean;
  keep: readonly string[];
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  remove: readonly string[];
  toName: string;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <SheetContent side="right" className="w-[min(92vw,34rem)] sm:max-w-[34rem]">
        <SheetHeader className="border-b px-6 py-5 pr-14">
          <SheetTitle className="text-xl">Change Toolbox preset?</SheetTitle>
          <SheetDescription>Changing from {fromName} to {toName} will replace tools and knowledge supplied by the current preset. Manually added items are kept.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
          {instructionsCustomized ? (
            <p className="border-l-2 border-primary bg-primary/5 px-3 py-2.5 text-xs leading-5">
              Your customized Instructions will be kept. You can apply the new preset Instructions from the Toolbox after switching.
            </p>
          ) : null}
          <ChangeList label="Remove preset items" items={remove} empty="No current preset items need to be removed." />
          <ChangeList label="Add preset items" items={add} empty="The new preset has no additional items." />
          <ChangeList label="Keep manually added" items={keep} empty="No manually added capabilities." />
        </div>
        <SheetFooter className="flex-row justify-between border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={onConfirm}>Change preset <ArrowRight /></Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
