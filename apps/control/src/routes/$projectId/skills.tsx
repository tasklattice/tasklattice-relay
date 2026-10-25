import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  skillCategories,
  skillCompatibilityTargets,
  skillTrustLevels,
  type CreateSkillDefinitionInput,
  type SkillCompatibilityTarget,
  type SkillDefinition,
  type SkillTrustLevel,
} from "@tali/contracts";
import {
  ChevronDown,
  CircleHelp,
  Cloud,
  Database,
  Download,
  Pencil,
  Plus,
  Search,
  Package,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { formatPlatformDate } from "@/lib/platform-preferences";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetailList, EntitySheet } from "@/components/shared/entity-sheet";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { downloadBlob } from "@/lib/file-download";
import { getSkillAssurance } from "@/features/skills/skill-assurance";

export const Route = createFileRoute("/$projectId/skills")({ component: SkillCatalog });

type SkillSort = "category" | "name";
type SkillDraft = Pick<
  SkillDefinition,
  | "author"
  | "category"
  | "compatibleAgents"
  | "description"
  | "endpoint"
  | "name"
  | "problemStatement"
  | "trustLevel"
  | "usageGuide"
  | "version"
> & {
  useCasesText: string;
};

const compatibilityLabels = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
  "claude-code": "Claude Code",
  openai: "OpenAI",
  deepagents: "Deep Agents Code",
  pi: "Pi",
} satisfies Record<SkillCompatibilityTarget, string>;

const emptyDraft: SkillDraft = {
  author: "",
  category: "Developer Tools" as SkillDefinition["category"],
  compatibleAgents: ["openclaw"] as SkillCompatibilityTarget[],
  description: "",
  endpoint: "",
  name: "",
  problemStatement: "",
  trustLevel: "UNSAFE" as SkillTrustLevel,
  usageGuide: "",
  useCasesText: "",
  version: "1.0.0",
};

function skillInput(skill: SkillDefinition): CreateSkillDefinitionInput {
  const { id: _id, updatedAt: _updatedAt, ...input } = skill;
  return input;
}

function draftMetadata(draft: SkillDraft) {
  const { useCasesText, ...metadata } = draft;
  return {
    ...metadata,
    useCases: useCasesText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function toggleFilter<T extends string>(current: T[], value: T): T[] {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

function SkillCatalog() {
  const { t } = useTranslation("skills");
  const sourceLabels = useMemo(() => ({
    BUILT_IN: t("assurance.source.builtIn"),
    TRUSTED_SOURCE: t("assurance.source.markedTrusted"),
    UNSAFE: t("assurance.source.unverified"),
  }) satisfies Record<SkillTrustLevel, string>, [t]);
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const catalog = useQuery({ queryKey: scope.key("resource-catalog"), queryFn: api.getResourceCatalog });
  const items = catalog.data?.skills ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<SkillDefinition["category"][]>([]);
  const [trustLevels, setTrustLevels] = useState<SkillTrustLevel[]>([]);
  const [compatibilities, setCompatibilities] = useState<SkillCompatibilityTarget[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SkillSort>("name");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const visible = useMemo(
    () => {
      const normalizedQuery = query.trim().toLowerCase();
      return items
        .filter(
          (item) =>
            (!categories.length || categories.includes(item.category)) &&
            (!trustLevels.length || trustLevels.includes(item.trustLevel)) &&
            (!compatibilities.length || compatibilities.some((target) => item.compatibleAgents.includes(target))) &&
            `${item.name} ${item.description} ${item.problemStatement} ${item.useCases.join(" ")} ${item.usageGuide} ${item.author} ${item.owner} ${item.category} ${item.version} ${item.status} ${sourceLabels[item.trustLevel]} ${item.compatibleAgents.map((target) => compatibilityLabels[target]).join(" ")}`
              .toLowerCase()
              .includes(normalizedQuery),
        )
        .sort((left, right) => {
          if (sort === "category") {
            return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
          }
          return left.name.localeCompare(right.name);
        });
    },
    [categories, compatibilities, items, query, sort, trustLevels, sourceLabels],
  );
  const categoryOptions = useMemo(
    () =>
      skillCategories
        .map((category) => ({
          category,
          count: items.filter((skill) => skill.category === category).length,
        }))
        .filter(({ count }) => count),
    [items],
  );
  const trustOptions = useMemo(
    () =>
      skillTrustLevels.map((trustLevel) => ({
        trustLevel,
        count: items.filter((skill) => skill.trustLevel === trustLevel).length,
      })),
    [items],
  );
  const compatibilityOptions = useMemo(
    () =>
      skillCompatibilityTargets.map((target) => ({
        target,
        count: items.filter((skill) => skill.compatibleAgents.includes(target)).length,
      })),
    [items],
  );
  const activeFilterCount = categories.length + trustLevels.length + compatibilities.length;
  const selected = items.find((item) => item.id === selectedId);
  const saveSkill = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateSkillDefinitionInput }) => id ? api.updateSkill(id, input) : api.createSkill(input),
    onSuccess: async (skill, variables) => {
      setSelectedId(skill.id);
      setFormOpen(false);
      setFormError("");
      setNotice(variables.id ? "Skill metadata updated." : "Skill registered.");
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
    },
  });
  const downloadSkill = useMutation({
    mutationFn: (skill: SkillDefinition) => api.downloadSkillArtifact(skill.id),
    onSuccess: ({ blob, fileName }) => {
      downloadBlob(blob, fileName);
      setNotice(`Downloaded ${fileName}.`);
    },
  });
  const deleteSkill = useMutation({
    mutationFn: (id: string) => api.deleteResource("skills", id),
    onSuccess: async () => {
      setDeleteOpen(false);
      setDetailOpen(false);
      setSelectedId("");
      setNotice("Skill removed.");
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
    },
  });

  const openCreate = () => {
    saveSkill.reset();
    setEditingId(null);
    setDraft(emptyDraft);
    setFormError("");
    setFormOpen(true);
    setNotice("");
  };
  const openEdit = () => {
    if (!selected) return;
    setDetailOpen(false);
    saveSkill.reset();
    setEditingId(selected.id);
    setDraft({
      author: selected.author,
      category: selected.category,
      compatibleAgents: [...selected.compatibleAgents],
      description: selected.description,
      endpoint: selected.endpoint,
      name: selected.name,
      problemStatement: selected.problemStatement,
      trustLevel: selected.trustLevel,
      usageGuide: selected.usageGuide,
      useCasesText: selected.useCases.join("\n"),
      version: selected.version,
    });
    setFormError("");
    setFormOpen(true);
    setNotice("");
  };
  const save = () => {
    const metadata = draftMetadata(draft);
    if (
      !draft.name.trim() ||
      !draft.description.trim() ||
      !draft.problemStatement.trim() ||
      !draft.usageGuide.trim() ||
      !draft.author.trim() ||
      !draft.endpoint.trim() ||
      !draft.compatibleAgents.length ||
      !metadata.useCases.length
    ) {
      setFormError("Complete the summary, problem, use cases, usage guide, author, source, and compatibility metadata.");
      return;
    }
    setFormError("");
    const current = editingId ? items.find((item) => item.id === editingId) : undefined;
    const sourceChanged = current
      ? current.endpoint !== draft.endpoint || current.version !== draft.version
      : true;
    void saveSkill.mutate({
      ...(editingId ? { id: editingId } : {}),
      input: current
        ? {
            ...skillInput(current),
            ...metadata,
            status: sourceChanged ? "DRAFT" : current.status,
            digest: sourceChanged ? "Source changed · check required" : current.digest,
          }
        : {
            ...metadata,
            digest: "Pending source check",
            owner: "Current Project",
            permissions: 0,
            status: "DRAFT",
          },
    });
  };
  const downloadSelected = () => {
    if (!selected || !selected.endpoint.startsWith("tali+postgresql:")) return;
    setNotice("");
    downloadSkill.reset();
    downloadSkill.mutate(selected);
  };
  const remove = () => {
    if (!selected) return;
    deleteSkill.reset();
    setDetailOpen(false);
    setDeleteOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        actions={<Button className="h-11" onClick={openCreate}><Plus /> Register Skill</Button>}
      />

      {catalog.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive">{catalog.error.message}</p> : null}
      {deleteSkill.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive">{deleteSkill.error.message}</p> : null}

      {notice ? <p role="status" className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm">{notice}</p> : null}

      <div className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-end">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Search Skills, categories, or owners</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search skills"
            className="h-11 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Skills, categories, or owners…"
          />
        </label>
        <span className="ml-auto hidden pb-3 text-xs tabular-nums text-muted-foreground md:block">
          Showing {visible.length} of {items.length} Skills
        </span>
        <Select value={sort} onValueChange={(value) => setSort(value as SkillSort)}>
          <SelectTrigger className="h-11 w-full sm:w-48" aria-label="Sort Skills">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="category">Category</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="self-start border-b pb-5 lg:sticky lg:top-24 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-0 text-sm font-semibold lg:pointer-events-none"
              aria-expanded={mobileFiltersOpen}
              aria-controls="skill-filters"
              onClick={() => setMobileFiltersOpen((current) => !current)}
            >
              Filters
              {activeFilterCount ? (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
              <ChevronDown
                className={`ml-1 size-3.5 transition-transform lg:hidden ${
                  mobileFiltersOpen ? "rotate-180" : ""
                }`}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2"
              disabled={!activeFilterCount}
              onClick={() => {
                setCategories([]);
                setTrustLevels([]);
                setCompatibilities([]);
              }}
            >
              Clear
            </Button>
          </div>
          <div
            id="skill-filters"
            className={`sm:grid-cols-2 lg:grid lg:grid-cols-1 ${
              mobileFiltersOpen ? "grid" : "hidden"
            }`}
          >
            <SkillCategoryGroup title="Capability domains">
              <div className="grid gap-1 pt-1">
                {categoryOptions.map(({ category, count }) => (
                  <SkillCategoryOption
                    key={category}
                    active={categories.includes(category)}
                    count={count}
                    label={category}
                    onClick={() => setCategories(toggleFilter(categories, category))}
                  />
                ))}
              </div>
            </SkillCategoryGroup>
            <SkillCategoryGroup title={t("assurance.sourceFilter")}>
              <div className="grid gap-1 pt-1">
                {trustOptions.map(({ trustLevel, count }) => (
                  <SkillCategoryOption
                    key={trustLevel}
                    active={trustLevels.includes(trustLevel)}
                    count={count}
                    label={sourceLabels[trustLevel]}
                    onClick={() => setTrustLevels(toggleFilter(trustLevels, trustLevel))}
                  />
                ))}
              </div>
            </SkillCategoryGroup>
            <SkillCategoryGroup title="Compatibility">
              <div className="grid gap-1 pt-1">
                {compatibilityOptions.map(({ target, count }) => (
                  <SkillCategoryOption
                    key={target}
                    active={compatibilities.includes(target)}
                    count={count}
                    label={compatibilityLabels[target]}
                    onClick={() => setCompatibilities(toggleFilter(compatibilities, target))}
                  />
                ))}
              </div>
            </SkillCategoryGroup>
          </div>
        </aside>

        <section aria-label="Skill catalog">
          {catalog.isPending ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4" aria-label="Loading Skills">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-64 rounded-lg" />
              ))}
            </div>
          ) : visible.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">
              {visible.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onDetails={() => {
                    deleteSkill.reset();
                    setSelectedId(skill.id);
                    setDetailOpen(true);
                    setNotice("");
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No Skills match"
              description="Adjust the domain, trust, or compatibility filters, or try a different search."
            />
          )}
        </section>
      </div>

      <EntitySheet
        open={detailOpen && Boolean(selected)}
        onOpenChange={setDetailOpen}
        eyebrow="Skill"
        title={selected?.name ?? "Skill details"}
        description={selected?.description ?? "Review this Skill's source, ownership, and publication status."}
        width="md"
        footer={(
          <div className="grid w-full gap-2 sm:grid-cols-3">
            <Button className="w-full" variant="outline" onClick={openEdit}>
              <Pencil /> Update metadata
            </Button>
            <Button
              className="w-full"
              disabled={
                downloadSkill.isPending
                || !selected?.endpoint.startsWith("tali+postgresql:")
              }
              onClick={downloadSelected}
            >
              <Download />{downloadSkill.isPending ? "Downloading…" : "Download .tar.gz"}
            </Button>
            <Button
              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              variant="outline"
              disabled={deleteSkill.isPending}
              onClick={remove}
            >
              <Trash2 />{deleteSkill.isPending ? "Removing…" : "Remove Skill"}
            </Button>
          </div>
        )}
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <StatusDot label={selected.status} tone={selected.status === "PUBLISHED" ? "success" : "neutral"} />
            </div>
            <SkillAssuranceDetails skill={selected} />
            <div className="divide-y border-y">
              <SkillInformationSection title="What problem does it solve?">
                <p>{selected.problemStatement}</p>
              </SkillInformationSection>
              <SkillInformationSection title="Best for">
                <ul className="space-y-2">
                  {selected.useCases.map((useCase) => (
                    <li key={useCase} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{useCase}</span>
                    </li>
                  ))}
                </ul>
              </SkillInformationSection>
              <SkillInformationSection title="How to use">
                <p>{selected.usageGuide}</p>
              </SkillInformationSection>
            </div>
            <h3 className="text-sm font-semibold">Package metadata</h3>
            <EntityDetailList items={[
              { label: "Category", value: selected.category },
              {
                label: "Compatibility",
                value: selected.compatibleAgents.map((target) => compatibilityLabels[target]).join(", "),
              },
              { label: "Version", value: `v${selected.version}`, mono: true },
              { label: "Author", value: selected.author },
              { label: "Owner", value: selected.owner },
              { label: "Last updated", value: formatPlatformDate(selected.updatedAt) },
              {
                label: selected.endpoint.startsWith("tali+postgresql:")
                  ? "Artifact storage"
                  : "Source endpoint",
                value: selected.endpoint.startsWith("tali+postgresql:")
                  ? "Stored Skill archive"
                  : selected.endpoint,
                mono: !selected.endpoint.startsWith("tali+postgresql:"),
              },
              { label: "Content digest", value: selected.digest, mono: true },
            ]} />
            <div className="border-l-2 border-border bg-muted/30 px-4 py-3 text-sm leading-6">
              {selected.endpoint.startsWith("tali+postgresql:") ? (
                <p className="flex gap-3"><Database className="mt-1 size-4 shrink-0 text-link" /><span><strong className="block">Stored package</strong>The stored Skill archive is available for download.</span></p>
              ) : (
                <p className="flex gap-3"><Cloud className="mt-1 size-4 shrink-0 text-link" /><span><strong className="block">Remote package</strong>The package remains external until it is imported into the artifact store.</span></p>
              )}
            </div>
            {notice ? <p role="status" className="border-l-2 border-primary bg-primary/5 p-3 text-sm">{notice}</p> : null}
            {downloadSkill.error || deleteSkill.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">{(downloadSkill.error ?? deleteSkill.error)?.message}</p> : null}
          </div>
        ) : null}
      </EntitySheet>

      {selected ? (
        <DeleteEntitySheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete Skill"
          description={<>Remove <strong>{selected.name}</strong> from this Project.</>}
          entityName={selected.name}
          confirmLabel="Delete Skill"
          deleting={deleteSkill.isPending}
          onConfirm={() => deleteSkill.mutate(selected.id)}
          {...(deleteSkill.error instanceof Error ? { error: deleteSkill.error.message } : {})}
          impactDescription="The Skill disappears from this Project and can no longer be selected for new work."
        />
      ) : null}

      <EntitySheet
        open={formOpen}
        onOpenChange={(open) => {
          if (!saveSkill.isPending) {
            setFormOpen(open);
            if (!open) {
              setFormError("");
              saveSkill.reset();
            }
          }
        }}
        eyebrow="Skill Catalog"
        title={editingId ? "Update Skill" : "Register Skill"}
        description="Persist package metadata in PostgreSQL. Source fetching remains simulated during development."
        width="md"
        footer={(
          <>
            <Button variant="outline" disabled={saveSkill.isPending} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="skill-form" disabled={saveSkill.isPending}>{saveSkill.isPending ? "Saving…" : editingId ? "Save changes" : "Register Skill"}</Button>
          </>
        )}
      >
        <form id="skill-form" className="space-y-7" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <SkillFormSection
            title="About"
            description="The short identity people use while browsing the catalog."
          >
            <div className="space-y-2"><Label htmlFor="skill-name" required>Name</Label><Input id="skill-name" className="h-11" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Release Notes" autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="skill-description" required>Summary</Label><Textarea id="skill-description" className="min-h-24" required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="A concise description shown on the Skill card." /></div>
            <div className="space-y-2"><Label htmlFor="skill-author" required>Author</Label><Input id="skill-author" className="h-11" required value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} placeholder="Team or package author" /></div>
          </SkillFormSection>

          <SkillFormSection
            title="Capability guidance"
            description="Help operators decide when this Skill is appropriate and how to invoke it safely."
          >
            <div className="space-y-2"><Label htmlFor="skill-problem" required>Problem it solves</Label><Textarea id="skill-problem" className="min-h-24" required value={draft.problemStatement} onChange={(event) => setDraft({ ...draft, problemStatement: event.target.value })} placeholder="What recurring problem does this Skill remove?" /></div>
            <div className="space-y-2">
              <Label htmlFor="skill-use-cases" required>Use cases</Label>
              <Textarea id="skill-use-cases" className="min-h-28" required value={draft.useCasesText} onChange={(event) => setDraft({ ...draft, useCasesText: event.target.value })} placeholder={"Prepare a release summary\nCompare approved change records"} />
              <p className="text-xs text-muted-foreground">One scenario per line, up to eight.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="skill-usage-guide" required>How to use</Label><Textarea id="skill-usage-guide" className="min-h-32" required value={draft.usageGuide} onChange={(event) => setDraft({ ...draft, usageGuide: event.target.value })} placeholder="Required context, connections, expected output, and review steps." /></div>
          </SkillFormSection>

          <SkillFormSection
            title="Distribution"
            description={t("assurance.distribution")}
          >
            <div className="space-y-2"><Label htmlFor="skill-endpoint" required>Remote package endpoint</Label><Input id="skill-endpoint" className="h-11" required value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://…/bundle.tar.zst" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="skill-version" required>Version</Label><Input id="skill-version" className="h-11" required value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="skill-category" required>Category</Label><select id="skill-category" required className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as SkillDefinition["category"] })}>{skillCategories.map((item) => <option key={item}>{item}</option>)}</select></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-source" required>{t("assurance.sourceLabel")}</Label>
              <select
                id="skill-source"
                aria-describedby="skill-source-help"
                required
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={draft.trustLevel}
                onChange={(event) => setDraft({ ...draft, trustLevel: event.target.value as SkillTrustLevel })}
              >
                {skillTrustLevels.map((level) => <option key={level} value={level}>{sourceLabels[level]}</option>)}
              </select>
              <p id="skill-source-help" className="text-xs leading-5 text-muted-foreground">{t("assurance.editHelp")}</p>
              <p className="text-xs text-muted-foreground">{t("assurance.riskAssessment")}: <span className="font-medium text-foreground">{t("assurance.risk.notAssessed")}</span></p>
            </div>
            <fieldset className="space-y-2">
              <legend className="flex items-center gap-1 text-sm font-medium">Agent compatibility <RequiredMark /></legend>
              <div className="flex flex-wrap gap-2">
                {skillCompatibilityTargets.map((target) => {
                  const active = draft.compatibleAgents.includes(target);
                  return (
                    <button
                      key={target}
                      type="button"
                      aria-pressed={active}
                      className={
                        active
                          ? "min-h-11 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          : "min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                      }
                      onClick={() => setDraft({
                        ...draft,
                        compatibleAgents: toggleFilter(draft.compatibleAgents, target),
                      })}
                    >
                      {compatibilityLabels[target]}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Select every Agent runtime that can load this Skill.</p>
            </fieldset>
          </SkillFormSection>
          {formError || saveSkill.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError || saveSkill.error?.message}</p> : null}
        </form>
      </EntitySheet>
    </div>
  );
}

function SkillCard({
  onDetails,
  skill,
}: {
  onDetails: () => void;
  skill: SkillDefinition;
}) {
  return (
    <article className="group flex min-h-64 flex-col rounded-lg border bg-card p-5 transition-colors hover:border-primary-border">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true"><Sparkles className="size-4" /></span>
        <StatusDot label={skill.status} tone={skill.status === "PUBLISHED" ? "success" : "neutral"} />
      </div>
      <button type="button" onClick={onDetails} aria-haspopup="dialog" className="mt-4 min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h2 className="text-sm font-semibold group-hover:text-link">{skill.name}</h2>
        <span className="mt-2 line-clamp-2 block min-h-10 text-xs leading-5 text-muted-foreground">{skill.description}</span>
      </button>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SkillSourceBadge source={skill.trustLevel} />
        <span className="text-xs text-muted-foreground">{skill.category}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{skill.compatibleAgents.map((target) => compatibilityLabels[target]).join(" · ")}</p>
      <footer className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" title={skill.author}>{skill.author} <span className="ml-1 font-mono">v{skill.version}</span></span>
        <Button type="button" variant="ghost" size="sm" onClick={onDetails} aria-label={`Details for ${skill.name}`}>Details</Button>
      </footer>
    </article>
  );
}

function SkillInformationSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

function SkillFormSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <fieldset className="space-y-4 border-t pt-5 first:border-t-0 first:pt-0">
      <legend className="w-full">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{description}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function SkillCategoryGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details open className="group border-t py-4 first:border-t-0">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold focus-visible:outline-2">
        {title}
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function SkillCategoryOption({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={
        active
          ? "flex min-h-11 items-center gap-2 rounded-md border border-primary-border bg-primary-surface px-3 py-2 text-left text-xs font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "flex min-h-11 items-center gap-2 rounded-md border border-transparent bg-transparent px-3 py-2 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      }
      onClick={onClick}
    >
      <span>{label}</span>
      <span className={active ? "ml-auto tabular-nums text-accent-foreground" : "ml-auto tabular-nums text-muted-foreground"}>
        {count}
      </span>
    </button>
  );
}

function SkillSourceBadge({ source }: { source: SkillTrustLevel }) {
  const { t } = useTranslation("skills");
  const assurance = getSkillAssurance(source);
  const Icon = source === "BUILT_IN" ? Package : source === "TRUSTED_SOURCE" ? Shield : CircleHelp;
  const label = t(`assurance.source.${assurance.source}`);
  return (
    <span
      title={`${t("assurance.sourceLabel")}: ${label}`}
      className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function SkillAssuranceDetails({ skill }: { skill: SkillDefinition }) {
  const { t } = useTranslation("skills");
  const assurance = getSkillAssurance(skill.trustLevel);
  return (
    <section aria-labelledby="skill-assurance-title" className="space-y-3">
      <h3 id="skill-assurance-title" className="text-sm font-semibold">{t("assurance.title")}</h3>
      <EntityDetailList items={[
        { label: t("assurance.sourceLabel"), value: t(`assurance.source.${assurance.source}`) },
        { label: t("assurance.sourceVerification"), value: t(`assurance.verification.${assurance.sourceVerification}`) },
        { label: t("assurance.riskAssessment"), value: t(`assurance.risk.${assurance.riskAssessment}`) },
      ]} />
      <p className="text-xs leading-5 text-muted-foreground">{t("assurance.explanation")}</p>
    </section>
  );
}
