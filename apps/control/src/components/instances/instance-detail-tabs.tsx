import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type {
  InstanceAccessState,
  InstanceDetailTab,
} from "./instance-detail-model";
import { instanceDetailTabs } from "./instance-detail-model";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrentProjectId } from "@/hooks/use-project";

const labels: Record<InstanceDetailTab, string> = {
  overview: "Overview",
  configuration: "Configuration",
  capabilities: "Capabilities",
  activity: "Activity",
  logs: "Logs",
  terminal: "Terminal",
};

export function InstanceTabs({
  active,
  instanceId,
  logs,
  terminal,
}: {
  active: InstanceDetailTab;
  instanceId: string;
  logs?: { enabled: boolean; disabledReason?: string };
  terminal: InstanceAccessState["terminal"];
}) {
  const projectId = useCurrentProjectId();
  const navRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const tab = activeTabRef.current;
    if (!nav || !tab) return;

    const centeredLeft =
      tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
    nav.scrollTo({
      behavior: "smooth",
      left: Math.max(0, centeredLeft),
    });
  }, [active]);

  return (
    <Tabs value={active} activationMode="manual">
      <nav
        ref={navRef}
        aria-label="Instance detail sections"
        className="-mx-1 snap-x snap-proximity overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsList variant="line" className="min-w-max px-1">
          {instanceDetailTabs.map((tab) => {
            const access =
              tab === "terminal"
                ? terminal
                : tab === "logs"
                  ? logs
                  : undefined;
            const disabled = access ? !access.enabled : false;
            if (disabled)
              return (
                <Tooltip key={tab}>
                  <TooltipTrigger asChild>
                    <span
                      ref={
                        tab === active
                          ? (element) => {
                              activeTabRef.current = element;
                            }
                          : undefined
                      }
                      className="inline-flex"
                    >
                      <TabsTrigger
                        value={tab}
                        disabled
                        aria-label={`${labels[tab]} unavailable. ${access?.disabledReason ?? `${labels[tab]} access is unavailable.`}`}
                        className="pointer-events-none min-h-11 snap-start"
                      >
                        {labels[tab]}
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{access?.disabledReason}</TooltipContent>
                </Tooltip>
              );
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                asChild
                className="min-h-11 snap-start"
              >
                <Link
                  ref={
                    tab === active
                      ? (element) => {
                          activeTabRef.current = element;
                        }
                      : undefined
                  }
                  to="/$projectId/instances/$instanceId"
                  params={{ projectId, instanceId }}
                  search={{ tab }}
                >
                  {labels[tab]}
                </Link>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </nav>
    </Tabs>
  );
}
