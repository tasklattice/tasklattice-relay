import type { AgentGardenIntegrationType } from "@tali/contracts";
import {
  Bot,
  Braces,
  Bug,
  ChartNoAxesCombined,
  ClipboardPlus,
  HandCoins,
  Headphones,
  Landmark,
  LibraryBig,
  Plane,
  ScanSearch,
  ShieldCheck,
  ShoppingBasket,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons: Partial<Record<AgentGardenIntegrationType, LucideIcon>> = {
  a2a: Waypoints,
};

const catalogIcons: Record<string, LucideIcon> = {
  bug: Bug,
  chart: ChartNoAxesCombined,
  "clipboard-plus": ClipboardPlus,
  "hand-coins": HandCoins,
  headphones: Headphones,
  landmark: Landmark,
  "library-big": LibraryBig,
  plane: Plane,
  "scan-search": ScanSearch,
  "shield-check": ShieldCheck,
  "shopping-basket": ShoppingBasket,
};

const brandAssets: Partial<Record<AgentGardenIntegrationType, string>> = {
  openclaw: "/assets/brands/openclaw-lobehub.webp",
  hermes: "/assets/brands/hermesagent-lobehub.webp",
  "claude-code": "/assets/providers/anthropic.webp",
  a2a: "/assets/agent-providers/a2a-agent.png",
};

export function AgentGardenIcon({
  className,
  catalogIcon,
  iconClassName,
  type,
}: {
  className?: string;
  catalogIcon?: string | undefined;
  iconClassName?: string;
  type: AgentGardenIntegrationType;
}) {
  const Icon = catalogIcons[catalogIcon ?? ""] ?? icons[type] ?? Bot;
  const asset = brandAssets[type];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-md border bg-background shadow-xs",
        className,
      )}
    >
      {asset && !catalogIcon ? (
        <img
          src={asset}
          alt=""
          className={cn("size-8 object-contain", iconClassName)}
        />
      ) : (
        <Icon className={cn("size-5 text-link", iconClassName)} />
      )}
    </span>
  );
}

export function AgentCapabilityIcon({
  capability,
}: {
  capability: "interactive" | "delegate" | "callable";
}) {
  const Icon =
    capability === "interactive"
      ? Braces
      : capability === "delegate"
        ? Workflow
        : Waypoints;
  return <Icon aria-hidden="true" className="size-3" />;
}
