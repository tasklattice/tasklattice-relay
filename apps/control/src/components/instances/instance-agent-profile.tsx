import type {
  AgentInstanceCapabilityView,
  AgentProtocolView,
} from "@tali/contracts";
import { Check, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DetailCardHeader } from "./instance-detail-shared";

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
        title={enabled ? "Available" : "Unavailable"}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium",
          enabled ? "text-success" : "text-muted-foreground",
        )}
      >
        {enabled ? (
          <Check className="size-3.5" />
        ) : (
          <Minus className="size-3.5" />
        )}
        <span className="sr-only">{enabled ? "Available" : "Unavailable"}</span>
      </span>
    </li>
  );
}

function CapabilityGroup({
  items,
  title,
}: {
  items: Array<{ enabled: boolean; label: string }>;
  title: string;
}) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold">{title}</h3>
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
    <Card className="@container/features">
      <DetailCardHeader title="Runtime features" />
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 @3xl/features:grid-cols-4">
        <CapabilityGroup
          title="Work profile"
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
          items={[
            { label: "Live runtime logs", enabled: capabilities.liveLogs },
            { label: "Executable terminal", enabled: capabilities.terminal },
          ]}
        />
        <CapabilityGroup
          title="Protocol"
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
