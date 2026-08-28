import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  BookOpenText,
  Code2,
  ScrollText,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import { ContextSidebarLayout } from "@/components/layout/context-sidebar-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useProject } from "@/hooks/use-project";
import { defaultLanguage, normalizeLanguage } from "@/i18n/config";
import {
  getHelpRoute,
  getHelpTopics,
  helpTopicIds,
  isHelpTopicId,
  type HelpTopic,
  type HelpTopicId,
} from "@/lib/help-content";
import { cn } from "@/lib/utils";

interface HelpSearch {
  topic?: HelpTopicId;
}

export const Route = createFileRoute("/$projectId/help")({
  validateSearch: (search: Record<string, unknown>): HelpSearch =>
    isHelpTopicId(search.topic) ? { topic: search.topic } : {},
  component: HelpPage,
});

const topicIcons: Record<HelpTopicId, LucideIcon> = {
  admin: ShieldCheck,
  developer: Code2,
  reviewer: BadgeCheck,
  auditor: ScrollText,
  user: UserRound,
  maintenance: Wrench,
  troubleshooting: TriangleAlert,
};

function TopicLink({
  active,
  projectId,
  topic,
}: {
  active: boolean;
  projectId: string;
  topic: HelpTopic;
}) {
  const Icon = topicIcons[topic.id];
  const { t } = useTranslation("help");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="h-11"
        isActive={active}
        size="lg"
      >
        <Link
          to="/$projectId/help"
          params={{ projectId }}
          search={{ topic: topic.id }}
          aria-current={active ? "page" : undefined}
        >
          <Icon />
          <span>{t(`topics.${topic.id}`)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function MarkdownDocument({ body, projectId }: { body: string; projectId: string }) {
  const components: Components = {
    h1: ({ children }) => (
      <h1 className="font-display text-2xl font-light tracking-[0.005em] sm:text-3xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-8 border-t pt-6 font-display text-xl font-medium tracking-tight first:mt-0 first:border-0 first:pt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-6 text-base font-semibold">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[0.9375rem]">
        {children}
      </p>
    ),
    ol: ({ children }) => (
      <ol className="mt-4 max-w-3xl list-decimal space-y-4 pl-6 text-sm leading-6 marker:font-mono marker:text-muted-foreground">
        {children}
      </ol>
    ),
    ul: ({ children }) => (
      <ul className="mt-4 max-w-3xl list-disc space-y-4 pl-6 text-sm leading-6 marker:text-muted-foreground">
        {children}
      </ul>
    ),
    li: ({ children }) => <li className="pl-1 text-muted-foreground">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    a: ({ children, href }) => {
      const route = getHelpRoute(href);
      const className = "font-medium text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
      return route ? (
        <Link className={className} to={route} params={{ projectId }}>
          {children}
        </Link>
      ) : (
        <a className={className} href={href} rel="noreferrer" target="_blank">
          {children}
        </a>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="mt-6 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-1 [&>p]:mt-2 [&>p]:mb-2">
        {children}
      </blockquote>
    ),
    pre: ({ children }) => (
      <div className="mt-4 overflow-hidden rounded-md border bg-foreground text-background">
        <div className="flex items-center gap-2 border-b border-background/15 px-3 py-2 font-mono text-[10px] text-background/70">
          <SquareTerminal className="size-3.5" />
          shell
        </div>
        <pre className="overflow-x-auto p-3 text-xs leading-5">{children}</pre>
      </div>
    ),
    code: ({ children, className }) => className ? (
      <code className={cn("font-mono", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    ),
  };

  return (
    <div className="py-6 sm:py-8 [&>h1+p]:text-base">
      <ReactMarkdown components={components} skipHtml>
        {body}
      </ReactMarkdown>
    </div>
  );
}

function HelpPage() {
  const { i18n, t } = useTranslation("help");
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
    defaultLanguage;
  const topics = getHelpTopics(language);
  const { currentProject } = useProject();
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const roleTopicId = currentProject?.activeRole ?? "user";
  const selectedTopicId = search.topic ?? roleTopicId;
  const selectedTopic = topics[selectedTopicId];
  const roleTopics = helpTopicIds
    .map((topicId) => topics[topicId])
    .filter((topic) => topic.category === "role");
  const operationsTopics = helpTopicIds
    .map((topicId) => topics[topicId])
    .filter((topic) => topic.category === "operations");

  const selectTopic = (topic: HelpTopicId) => {
    void navigate({ search: { topic } });
  };

  return (
    <ContextSidebarLayout
      sidebar={(
        <>
          <SidebarHeader className="h-16 shrink-0 justify-center border-b border-sidebar-border px-5 py-0">
            <strong className="font-display text-xl font-medium">{t("title")}</strong>
            <span className="text-xs text-muted-foreground">{t("navigation.title")}</span>
          </SidebarHeader>
          <SidebarContent className="py-3">
            <nav aria-label={t("navigation.title")}>
              <SidebarGroup>
                <SidebarGroupLabel>{t("navigation.userGuides")}</SidebarGroupLabel>
                <p className="px-3 pb-2 text-xs leading-5 text-muted-foreground">
                  {t("navigation.userGuidesDescription")}
                </p>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {roleTopics.map((topic) => (
                      <TopicLink
                        key={topic.id}
                        active={selectedTopicId === topic.id}
                        projectId={projectId}
                        topic={topic}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup className="mt-2 border-t border-sidebar-border pt-3">
                <SidebarGroupLabel>{t("navigation.operations")}</SidebarGroupLabel>
                <p className="px-3 pb-2 text-xs leading-5 text-muted-foreground">
                  {t("navigation.operationsDescription")}
                </p>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {operationsTopics.map((topic) => (
                      <TopicLink
                        key={topic.id}
                        active={selectedTopicId === topic.id}
                        projectId={projectId}
                        topic={topic}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
          </SidebarContent>
        </>
      )}
      mobileNavigation={(
        <>
          <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="help-topic-select">
            {t("browse")}
          </label>
          <Select
            value={selectedTopicId}
            onValueChange={(value) => selectTopic(value as HelpTopicId)}
          >
            <SelectTrigger id="help-topic-select" size="lg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t("navigation.userGuides")}</SelectLabel>
                {roleTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {t(`topics.${topic.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t("navigation.operations")}</SelectLabel>
                {operationsTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {t(`topics.${topic.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </>
      )}
    >
      <div className="mx-auto w-full max-w-5xl p-5 sm:p-6 lg:p-8">
        <PageHeader
          title={t("title")}
          description={t("description")}
          badge={
            <Badge variant="outline" className="gap-1.5">
              <BookOpenText />
              {t("navigation.userGuides")} · {t("navigation.operations")}
            </Badge>
          }
        />

        <article className="mt-7 min-w-0">
          <header className="border-b pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {selectedTopic.category === "role"
                  ? t("navigation.userGuides")
                  : t("navigation.operations")}
              </Badge>
              {selectedTopic.id === roleTopicId ? (
                <Badge variant="outline">{t("currentRole")}</Badge>
              ) : null}
              {selectedTopic.preview ? (
                <Badge variant="outline" className="border-amber-500/35 text-amber-700 dark:text-amber-300">
                  {t("preview")}
                </Badge>
              ) : null}
            </div>
          </header>
          <MarkdownDocument body={selectedTopic.body} projectId={projectId} />
        </article>
      </div>
    </ContextSidebarLayout>
  );
}
