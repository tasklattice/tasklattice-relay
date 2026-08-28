import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  MemoryConversation,
  MemoryExperience,
  MemoryExperienceUpdateInput,
  MemoryFact,
  MemoryItem,
} from "@tali/contracts";
import {
  Check,
  ChevronDown,
  FileSearch,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { errorMessage, formatMemoryDate, MemoryNotice } from "./memory-ui";

export function ConversationSheet({
  canCurate,
  canDelete,
  canReextract,
  conversation,
  memoryId,
  onNotice,
  onOpenChange,
  onUpdated,
}: {
  canCurate: boolean;
  canDelete: boolean;
  canReextract: boolean;
  conversation: MemoryConversation | null;
  memoryId: string;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<unknown> | void;
}) {
  const [mode, setMode] = useState<"view" | "redact" | "delete">("view");
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [replacement, setReplacement] = useState("[Redacted]");

  useEffect(() => {
    setMode("view");
    setSelectedMessages([]);
    setReplacement("[Redacted]");
  }, [conversation?.id]);

  const close = () => onOpenChange(false);
  const redact = useMutation({
    mutationFn: () => {
      if (!conversation) throw new Error("Select a Conversation.");
      return api.redactMemoryConversation(memoryId, conversation.id, selectedMessages, replacement);
    },
    onSuccess: async (result) => {
      onNotice(`${result.redactedMessages} message${result.redactedMessages === 1 ? " was" : "s were"} redacted. Derived content is being rebuilt.`);
      await onUpdated();
      close();
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!conversation) throw new Error("Select a Conversation.");
      return api.deleteMemoryConversation(memoryId, conversation.id);
    },
    onSuccess: async (result) => {
      onNotice(`Conversation deleted. ${result.invalidatedDerivedItems} orphaned derived item${result.invalidatedDerivedItems === 1 ? " was" : "s were"} invalidated.`);
      await onUpdated();
      close();
    },
  });
  const reextract = useMutation({
    mutationFn: () => {
      if (!conversation) throw new Error("Select a Conversation.");
      return api.reextractMemoryConversation(memoryId, conversation.id);
    },
    onSuccess: async () => {
      onNotice("Conversation re-extraction was accepted.");
      await onUpdated();
      close();
    },
  });
  const pending = redact.isPending || remove.isPending || reextract.isPending;
  const error = redact.error ?? remove.error ?? reextract.error;
  const toggleMessage = (id: string) => setSelectedMessages((selected) =>
    selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
  );

  return (
    <EntitySheet
      open={Boolean(conversation)}
      onOpenChange={(open) => { if (!pending) onOpenChange(open); }}
      eyebrow={mode === "view" ? "Conversation" : mode === "redact" ? "Redact messages" : "Confirm deletion"}
      title={conversation?.title || "Retained conversation"}
      description={conversation
        ? `${formatMemoryDate(conversation.startedAt)} · ${conversation.messages.length} messages`
        : "Conversation details"}
      width="lg"
      footer={mode === "delete" ? (
        <>
          <Button variant="outline" disabled={pending} onClick={() => setMode("view")}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={() => remove.mutate()}><Trash2 />{remove.isPending ? "Deleting…" : "Delete conversation"}</Button>
        </>
      ) : mode === "redact" ? (
        <>
          <Button variant="outline" disabled={pending} onClick={() => setMode("view")}>Cancel</Button>
          <Button disabled={!selectedMessages.length || !replacement.trim() || pending} onClick={() => redact.mutate()}><ShieldOff />{redact.isPending ? "Redacting…" : `Redact ${selectedMessages.length || "selected"}`}</Button>
        </>
      ) : (
        <>
          {canCurate ? <Button variant="outline" disabled={pending} onClick={() => { redact.reset(); setMode("redact"); }}><ShieldOff />Redact</Button> : null}
          {canReextract ? <Button variant="outline" disabled={pending} onClick={() => reextract.mutate()}><RefreshCw />{reextract.isPending ? "Requesting…" : "Re-extract"}</Button> : null}
          {canDelete ? <Button variant="destructive" disabled={pending} onClick={() => { remove.reset(); setMode("delete"); }}><Trash2 />Delete</Button> : null}
        </>
      )}
    >
      {conversation ? (
        <div className="space-y-5">
          {mode === "delete" ? (
            <MemoryNotice tone="warning">Deleting the source Conversation can invalidate Facts and Insights that have no remaining evidence. Provider deletion is verified before success is shown.</MemoryNotice>
          ) : null}
          {mode === "redact" ? (
            <div className="space-y-2">
              <Label htmlFor="memory-redaction-replacement">Replacement text</Label>
              <Input id="memory-redaction-replacement" className="h-11" maxLength={240} value={replacement} onChange={(event) => setReplacement(event.target.value)} />
              <p className="text-xs leading-5 text-muted-foreground">Choose each message that must be replaced. Existing derived content is invalidated before the redacted source is extracted again.</p>
            </div>
          ) : null}
          {conversation.summary ? <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h3><p className="mt-2 text-sm leading-6">{conversation.summary}</p></section> : null}
          <section aria-labelledby="conversation-messages-heading">
            <h3 id="conversation-messages-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messages</h3>
            <div className="mt-3 space-y-3">
              {conversation.messages.map((message) => {
                const selected = selectedMessages.includes(message.id);
                return (
                  <article key={message.id} className={cn("rounded-xl border p-4", selected && "border-primary bg-primary/5")}>
                    <div className="flex items-start gap-3">
                      {mode === "redact" ? (
                        <button type="button" role="checkbox" aria-checked={selected} aria-label={`${selected ? "Keep" : "Redact"} ${message.role} message`} className={cn("grid size-11 shrink-0 place-items-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring/35", selected && "border-primary bg-primary text-primary-foreground")} onClick={() => toggleMessage(message.id)}>{selected ? <Check className="size-4" /> : null}</button>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs capitalize">{message.role}</strong><time className="text-[11px] text-muted-foreground">{formatMemoryDate(message.occurredAt)}</time></div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          {conversation.sourceDocumentIds.length ? <EvidenceIds ids={conversation.sourceDocumentIds} /> : null}
          {error ? <MemoryNotice tone="error">{errorMessage(error)}</MemoryNotice> : null}
        </div>
      ) : null}
    </EntitySheet>
  );
}

export function FactSheet({
  canCurate,
  fact,
  memoryId,
  onOpenChange,
  onUpdated,
}: {
  canCurate: boolean;
  fact: MemoryFact | null;
  memoryId: string;
  onOpenChange: (open: boolean) => void;
  onUpdated: (fact: MemoryFact) => Promise<unknown> | void;
}) {
  const [current, setCurrent] = useState<MemoryFact | null>(fact);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact?.text ?? "");
  useEffect(() => { setCurrent(fact); setText(fact?.text ?? ""); setEditing(false); }, [fact]);

  const update = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Select a Fact.");
      return api.updateMemoryFact(memoryId, current.id, { text, expectedUpdatedAt: current.updatedAt });
    },
    onSuccess: async (next) => { setCurrent(next); setText(next.text); setEditing(false); await onUpdated(next); },
  });
  const status = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Select a Fact.");
      return api.setMemoryItemStatus(memoryId, current.id, current.status === "active" ? "invalidate" : "restore");
    },
    onSuccess: async (next) => {
      if (next.kind !== "fact") return;
      setCurrent(next);
      await onUpdated(next);
    },
  });
  const pending = update.isPending || status.isPending;
  const conflict = update.error instanceof ApiError && update.error.status === 409;

  return (
    <EntitySheet
      open={Boolean(fact)}
      onOpenChange={(open) => { if (!pending) onOpenChange(open); }}
      eyebrow="Fact"
      title="Evidence-backed Fact"
      description={current ? `Updated ${formatMemoryDate(current.updatedAt)}` : "Fact details"}
      width="memory"
      footer={editing ? (
        <><Button variant="outline" disabled={pending} onClick={() => { setText(current?.text ?? ""); setEditing(false); update.reset(); }}>Cancel</Button><Button disabled={!text.trim() || pending} onClick={() => update.mutate()}>{update.isPending ? "Saving…" : "Save revision"}</Button></>
      ) : (
        <>
          {canCurate ? <Button variant="outline" disabled={pending} onClick={() => { update.reset(); setEditing(true); }}><Pencil />Edit</Button> : null}
          {canCurate ? <Button variant="outline" disabled={pending} onClick={() => status.mutate()}>{current?.status === "active" ? <ShieldOff /> : <RotateCcw />}{current?.status === "active" ? "Invalidate" : "Restore"}</Button> : null}
        </>
      )}
    >
      {current ? <div className="space-y-6">
        <section><Label htmlFor="memory-fact-text">Statement</Label>{editing ? <Textarea id="memory-fact-text" autoFocus className="mt-2 min-h-40" value={text} onChange={(event) => setText(event.target.value)} /> : <p id="memory-fact-text" className="mt-2 whitespace-pre-wrap text-base leading-7">{current.text}</p>}</section>
        <div className="grid grid-cols-2 gap-4 border-y py-4 text-xs"><span><span className="block text-muted-foreground">Status</span><strong className="mt-1 block capitalize">{current.status}</strong></span><span><span className="block text-muted-foreground">Evidence</span><strong className="mt-1 block">{current.evidence.length} source{current.evidence.length === 1 ? "" : "s"}</strong></span></div>
        <EvidenceList evidence={current.evidence} />
        {conflict ? <MemoryNotice tone="warning" action={<Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Reload Fact</Button>}>This Fact changed after you opened it. Your draft was not applied; reload before editing again.</MemoryNotice> : null}
        {update.error && !conflict ? <MemoryNotice tone="error">{errorMessage(update.error)}</MemoryNotice> : null}
        {status.error ? <MemoryNotice tone="error">{errorMessage(status.error)}</MemoryNotice> : null}
      </div> : null}
    </EntitySheet>
  );
}

export function ExperienceSheet({
  canCurate,
  experience,
  memoryId,
  onOpenChange,
  onUpdated,
}: {
  canCurate: boolean;
  experience: MemoryExperience | null;
  memoryId: string;
  onOpenChange: (open: boolean) => void;
  onUpdated: (experience: MemoryExperience) => Promise<unknown> | void;
}) {
  const [current, setCurrent] = useState<MemoryExperience | null>(experience);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ExperienceDraft>(() => experienceDraft(experience));
  const evidenceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setCurrent(experience); setDraft(experienceDraft(experience)); setEditing(false); }, [experience]);

  const update = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Select an Experience.");
      return api.updateMemoryExperience(memoryId, current.id, experienceInput(draft, current.version));
    },
    onSuccess: async (next) => { setCurrent(next); setDraft(experienceDraft(next)); setEditing(false); await onUpdated(next); },
  });
  const status = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Select an Experience.");
      return api.setMemoryItemStatus(memoryId, current.id, current.status === "active" ? "invalidate" : "restore");
    },
    onSuccess: async (next) => {
      if (next.kind !== "experience") return;
      setCurrent(next);
      setDraft(experienceDraft(next));
      await onUpdated(next);
    },
  });
  const pending = update.isPending || status.isPending;
  const conflict = update.error instanceof ApiError && update.error.status === 409;
  const set = <K extends keyof ExperienceDraft>(key: K, value: ExperienceDraft[K]) => setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));

  return (
    <EntitySheet
      open={Boolean(experience)}
      onOpenChange={(open) => { if (!pending) onOpenChange(open); }}
      eyebrow="Experience"
      title={current?.title || "Experience details"}
      description={current ? `Version ${current.version} · ${formatMemoryDate(current.occurredStart ?? current.createdAt)}` : "Structured Agent experience"}
      width="memory"
      footer={editing ? (
        <><Button variant="outline" disabled={pending} onClick={() => { setDraft(experienceDraft(current)); setEditing(false); update.reset(); }}>Cancel</Button><Button disabled={!draft.title.trim() || !draft.summary.trim() || pending} onClick={() => update.mutate()}>{update.isPending ? "Saving…" : "Save changes"}</Button></>
      ) : (
        <>
          {canCurate ? <Button variant="outline" disabled={pending} onClick={() => { update.reset(); setEditing(true); }}><Pencil />Edit</Button> : null}
          <Button variant="outline" onClick={() => evidenceHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><FileSearch />View evidence</Button>
          {canCurate ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label="Experience actions"><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={pending} onSelect={() => status.mutate()}>{current?.status === "active" ? <ShieldOff /> : <RotateCcw />}{current?.status === "active" ? "Invalidate" : "Restore"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}
        </>
      )}
    >
      {current ? <div className="space-y-6">
        {editing ? <ExperienceForm draft={draft} onChange={set} /> : <ExperienceView experience={current} />}
        <section id="experience-evidence" className="scroll-mt-6" aria-labelledby="experience-evidence-heading"><h3 ref={evidenceHeading} id="experience-evidence-heading" tabIndex={-1} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none">Source evidence</h3><div className="mt-3"><EvidenceList evidence={current.evidence} sourceIds={current.sourceDocumentIds} /></div></section>
        {conflict ? <MemoryNotice tone="warning" action={<Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Reload Experience</Button>}>This Experience is now a newer version. Your draft was not applied; reload it before editing again.</MemoryNotice> : null}
        {update.error && !conflict ? <MemoryNotice tone="error">{errorMessage(update.error)}</MemoryNotice> : null}
        {status.error ? <MemoryNotice tone="error">{errorMessage(status.error)}</MemoryNotice> : null}
      </div> : null}
    </EntitySheet>
  );
}

function ExperienceView({ experience }: { experience: MemoryExperience }) {
  return <div className="space-y-6">
    <MemoryField label="Summary" value={experience.summary} />
    <MemoryField label="Situation" value={experience.situation} />
    <MemoryField label="Goal" value={experience.goal} />
    <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h3>{experience.actions.length ? <ol className="mt-2 space-y-2 pl-5 text-sm leading-6">{experience.actions.map((action, index) => <li key={`${action}-${index}`} className="list-decimal pl-1">{action}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No actions recorded.</p>}</section>
    <MemoryField label="Outcome" value={experience.outcome} />
    <MemoryField label="Lesson learned" value={experience.lessonLearned} />
  </div>;
}

interface ExperienceDraft {
  title: string;
  summary: string;
  situation: string;
  goal: string;
  actions: string;
  outcome: string;
  lessonLearned: string;
  occurredStart: string;
  occurredEnd: string;
}

function ExperienceForm({ draft, onChange }: { draft: ExperienceDraft; onChange: <K extends keyof ExperienceDraft>(key: K, value: ExperienceDraft[K]) => void }) {
  return <div className="space-y-5">
    <FormInput label="Title" id="experience-title" value={draft.title} onChange={(value) => onChange("title", value)} />
    <FormText label="Summary" id="experience-summary" value={draft.summary} onChange={(value) => onChange("summary", value)} />
    <FormText label="Situation" id="experience-situation" value={draft.situation} onChange={(value) => onChange("situation", value)} />
    <FormText label="Goal" id="experience-goal" value={draft.goal} onChange={(value) => onChange("goal", value)} />
    <FormText label="Actions (one per line)" id="experience-actions" value={draft.actions} onChange={(value) => onChange("actions", value)} />
    <FormText label="Outcome" id="experience-outcome" value={draft.outcome} onChange={(value) => onChange("outcome", value)} />
    <FormText label="Lesson learned" id="experience-lesson" value={draft.lessonLearned} onChange={(value) => onChange("lessonLearned", value)} />
    <div className="grid gap-4 sm:grid-cols-2"><FormInput type="datetime-local" label="Started" id="experience-start" value={draft.occurredStart} onChange={(value) => onChange("occurredStart", value)} /><FormInput type="datetime-local" label="Ended" id="experience-end" value={draft.occurredEnd} onChange={(value) => onChange("occurredEnd", value)} /></div>
  </div>;
}

function FormInput({ id, label, onChange, type = "text", value }: { id: string; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} className="h-11" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
function FormText({ id, label, onChange, value }: { id: string; label: string; onChange: (value: string) => void; value: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Textarea id={id} className="min-h-28" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
function MemoryField({ label, value }: { label: string; value: string }) {
  return <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value || "Not recorded."}</p></section>;
}

function EvidenceList({ evidence, sourceIds = [] }: { evidence: MemoryItem["evidence"]; sourceIds?: string[] }) {
  if (!evidence.length && !sourceIds.length) return <p className="text-sm text-muted-foreground">No source evidence is available.</p>;
  return <div className="space-y-3">
    {evidence.map((item, index) => <article key={`${item.sourceDocumentId}-${item.sourceItemId ?? index}`} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="font-mono text-xs">{item.sourceDocumentId}</strong>{item.occurredAt ? <time className="text-[11px] text-muted-foreground">{formatMemoryDate(item.occurredAt)}</time> : null}</div>{item.excerpt ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.excerpt}</p> : null}</article>)}
    {sourceIds.filter((id) => !evidence.some(({ sourceDocumentId }) => sourceDocumentId === id)).map((id) => <article key={id} className="rounded-xl border p-4 font-mono text-xs">{id}</article>)}
  </div>;
}

function EvidenceIds({ ids }: { ids: string[] }) {
  const headingId = useId();
  return <section aria-labelledby={headingId}><h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source documents</h3><div className="mt-2 flex flex-wrap gap-2">{ids.map((id) => <code key={id} className="rounded-md border bg-muted/30 px-2 py-1 text-[11px]">{id}</code>)}</div></section>;
}

function experienceDraft(experience: MemoryExperience | null | undefined): ExperienceDraft {
  return {
    title: experience?.title ?? "",
    summary: experience?.summary ?? "",
    situation: experience?.situation ?? "",
    goal: experience?.goal ?? "",
    actions: experience?.actions.join("\n") ?? "",
    outcome: experience?.outcome ?? "",
    lessonLearned: experience?.lessonLearned ?? "",
    occurredStart: localDateTime(experience?.occurredStart),
    occurredEnd: localDateTime(experience?.occurredEnd),
  };
}

function experienceInput(draft: ExperienceDraft, expectedVersion: number): MemoryExperienceUpdateInput {
  return {
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    situation: draft.situation,
    goal: draft.goal,
    actions: draft.actions.split("\n").map((item) => item.trim()).filter(Boolean),
    outcome: draft.outcome,
    lessonLearned: draft.lessonLearned,
    occurredStart: draft.occurredStart ? new Date(draft.occurredStart).toISOString() : null,
    occurredEnd: draft.occurredEnd ? new Date(draft.occurredEnd).toISOString() : null,
    expectedVersion,
  };
}

function localDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}
