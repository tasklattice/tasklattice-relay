/** Local-only component review. No API calls or persisted resource changes. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Folder, Move, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ResourceActionsMenu } from "@/components/shared/resource-actions-menu";
import { Button } from "@/components/ui/button";
import { NewFolderDialog, RenameMoveDialog, DeleteObjectDialog, UploadFilesSheet } from "@/features/vector-database-file-browser/vector-database-file-actions";
import { ProviderInteractionReview } from "./provider-interaction-review";
import "@/styles.css";

function InteractionReview() {
  const [action, setAction] = useState<"new" | "rename" | "move" | "delete" | "upload" | null>(null);
  const [name, setName] = useState("Operations evidence");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fail, setFail] = useState(false);
  const [dark, setDark] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  const open = (next: NonNullable<typeof action>) => { setError(""); setNotice(""); setName("Operations evidence"); setAction(next); };
  const onOpenChange = (next: boolean) => { if (!next && !pending) setAction(null); };
  const submit = () => {
    if (pending) return;
    setPending(true);
    setError("");
    window.setTimeout(() => {
      setPending(false);
      if (fail) { setFail(false); setError("Preview failure: the operation was not applied. Your input is preserved; retry when ready."); }
      else { setNotice("Preview operation completed. No resource data was changed."); setAction(null); }
    }, 1500);
  };
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader title="UI interaction review" description="Local component fixture with simulated responses. No API calls or saved changes."
        actions={<Button variant="outline" onClick={() => setDark(!dark)}>{dark ? "Light mode" : "Dark mode"}</Button>} />
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />Simulate failure</label>
      <section className="overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-lg font-semibold">Project files</h2>
          <div className="flex gap-2"><Button variant="outline" onClick={() => open("new")}>New folder</Button><Button variant="create" onClick={() => open("upload")}>Upload files</Button></div>
        </header>
        <div className="flex items-center gap-3 p-4">
          <Folder className="size-5 shrink-0 text-link" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">Operations evidence</p><p className="font-mono text-xs text-muted-foreground">14 files · 128 vector records</p></div>
          <ResourceActionsMenu resourceName="Operations evidence" actions={[
            { label: "Rename", variant: "edit", icon: <Pencil />, onSelect: () => open("rename") },
            { label: "Move", variant: "edit", icon: <Move />, onSelect: () => open("move") },
            { label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => open("delete") },
          ]} />
        </div>
      </section>
      {notice ? <p role="status" className="rounded-md border border-success-border bg-success-surface p-3 text-sm text-success-foreground">{notice}</p> : null}
      <ProviderInteractionReview />
      <NewFolderDialog open={action === "new"} onOpenChange={onOpenChange} name={name} onNameChange={setName} pending={pending} error={error} onSubmit={submit} />
      <RenameMoveDialog open={action === "rename" || action === "move"} onOpenChange={onOpenChange} mode={action === "move" ? "move" : "rename"} title="Operations evidence" name={name} onNameChange={setName} currentParentId={null} onParentChange={() => undefined} folders={[]} pending={pending} error={error} onSubmit={submit} />
      <DeleteObjectDialog open={action === "delete"} onOpenChange={onOpenChange} name="Operations evidence" type="folder" fileCount={14} vectorCount={128} processingFileCount={1} failedFileCount={0} pending={pending} error={error} onConfirm={submit} />
      <UploadFilesSheet open={action === "upload"} onOpenChange={onOpenChange} destination="/Operations evidence" files={files} onFiles={setFiles} pending={pending} error={error} onUpload={submit} />
    </main>
  );
}

// This entry is not part of the production route tree or build inputs.
if (import.meta.env.DEV) createRoot(document.getElementById("root")!).render(<InteractionReview />);
