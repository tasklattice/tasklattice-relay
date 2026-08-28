import type {
  AgentInstanceCapabilityView,
  AgentProtocolView,
} from "@tali/contracts";
import {
  Bot,
  Check,
  MessagesSquare,
  Minus,
  Network,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DetailCardHeader } from "./instance-detail-shared";

type WorkMode = {
  id: "coordinate" | "delegate" | "interactive" | "plan" | "execute";
  label: string;
  icon: typeof Bot;
};

function getWorkModes(capabilities: AgentInstanceCapabilityView): WorkMode[] {
  const modes: WorkMode[] = [];
  if (capabilities.canDelegate) {
    modes.push({ id: "coordinate", label: "Coordinates work", icon: Network });
  } else if (capabilities.canPlan) {
    modes.push({ id: "plan", label: "Plans work", icon: Bot });
  }
  if (capabilities.acceptsDelegation) {
    modes.push({
      id: "delegate",
      label: "Accepts delegated work",
      icon: MessagesSquare,
    });
  }
  if (capabilities.interactive) {
    modes.push({ id: "interactive", label: "Interactive", icon: Bot });
  }
  if (!modes.length) {
    modes.push({ id: "execute", label: "Focused execution", icon: Bot });
  }
  return modes;
}

export function InstanceWorkModeBadges({
  capabilities,
  compact = false,
}: {
  capabilities: AgentInstanceCapabilityView;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Agent work modes">
      {getWorkModes(capabilities).map((mode) => {
        const Icon = mode.icon;
        return (
          <Badge
            key={mode.id}
            variant="outline"
            className={cn(
              "gap-1.5 border-border/80 bg-background font-medium text-foreground",
              compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
            )}
          >
            <Icon className={compact ? "size-3" : "size-3.5"} />
            {mode.label}
          </Badge>
        );
      })}
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-12 grid-cols-[minmax(7rem,.8fr)_minmax(0,1.2fr)] items-center gap-4 border-b py-2 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-semibold">
        {value}
      </dd>
    </div>
  );
}

export function AgentProfilePanel({
  actions,
  description,
  facts,
  name,
  profileLabel,
  summary,
}: {
  actions?: ReactNode;
  description: string;
  facts: Array<{ label: string; value: ReactNode }>;
  name: string;
  profileLabel: string;
  summary: ReactNode;
}) {
  return (
    <section
      aria-labelledby="agent-capability-profile"
      className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.025)]"
    >
      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.75fr)]">
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Bot className="size-4" />
            Agent profile
          </div>
          <h2
            id="agent-capability-profile"
            className="mt-4 font-display text-2xl font-medium tracking-tight sm:text-3xl"
          >
            What {name} can do
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7">
            <strong>{profileLabel}.</strong> {description}
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
          {actions ? (
            <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
          ) : null}
        </div>

        <div className="border-t bg-muted/20 p-6 sm:p-8 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Working context</h3>
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <dl className="mt-4">
            {facts.map((fact) => (
              <ProfileFact
                key={fact.label}
                label={fact.label}
                value={fact.value}
              />
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function CapabilityRow({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 border-b py-2 last:border-b-0">
      <span className="text-xs font-medium">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium",
          enabled
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground",
        )}
      >
        {enabled ? (
          <Check className="size-3.5" />
        ) : (
          <Minus className="size-3.5" />
        )}
        {enabled ? "Available" : "Unavailable"}
      </span>
    </li>
  );
}

function CapabilityGroup({
  description,
  items,
  title,
}: {
  description: string;
  items: Array<{ enabled: boolean; label: string }>;
  title: string;
}) {
  return (
    <section className="min-w-0 border-t pt-4 first:border-t-0 first:pt-0 md:border-l md:border-t-0 md:pl-5 md:first:border-l-0 md:first:pl-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <ul className="mt-2">
        {items.map((item) => (
          <CapabilityRow key={item.label} {...item} />
        ))}
      </ul>
    </section>
  );
}

export function AgentCapabilityMatrix({
  capabilities,
  protocol,
}: {
  capabilities: AgentInstanceCapabilityView;
  protocol?: AgentProtocolView | undefined;
}) {
  return (
    <Card>
      <DetailCardHeader
        title="Capability matrix"
        description="The same capability groups describe every Agent. Available features come from the runtime and advertised protocols."
      />
      <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CapabilityGroup
          title="Work profile"
          description="How the Agent reasons and works with a user."
          items={[
            { label: "Plans work", enabled: capabilities.canPlan },
            {
              label: "Interactive workspace",
              enabled: capabilities.interactive,
            },
          ]}
        />
        <CapabilityGroup
          title="Coordination"
          description="How this Agent participates in multi-Agent work."
          items={[
            { label: "Can delegate", enabled: capabilities.canDelegate },
            {
              label: "Accepts delegation",
              enabled: capabilities.acceptsDelegation,
            },
          ]}
        />
        <CapabilityGroup
          title="Operations"
          description="Surfaces available to operators at runtime."
          items={[
            { label: "Live runtime logs", enabled: capabilities.liveLogs },
            { label: "Executable terminal", enabled: capabilities.terminal },
          ]}
        />
        <CapabilityGroup
          title="Protocol"
          description="A2A features advertised by the active protocol."
          items={[
            {
              label: "Streaming",
              enabled:
                protocol?.type === "A2A" && protocol.capabilities.streaming,
            },
            {
              label: "Push notifications",
              enabled:
                protocol?.type === "A2A" &&
                protocol.capabilities.pushNotifications,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
