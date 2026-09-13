import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type CreationStep = {
  description: string;
  label: string;
};

export function CreationFlow({
  canNavigateBack = true,
  children,
  currentStep,
  onStepChange,
  orientation = "horizontal",
  progressLabel,
  steps,
}: {
  canNavigateBack?: boolean;
  children: ReactNode;
  currentStep: number;
  onStepChange: (step: number) => void;
  orientation?: "horizontal" | "sidebar";
  progressLabel: string;
  steps: readonly CreationStep[];
}) {
  const sidebar = orientation === "sidebar";
  const mobile = useIsMobile();
  const mobileSidebar = sidebar && mobile;
  const vertical = sidebar && !mobile;
  const activeValue = currentStep + 1;

  const changeStep = (value: number) => {
    const next = value - 1;
    if (canNavigateBack && next <= currentStep) onStepChange(next);
  };

  return (
    <Stepper
      value={activeValue}
      onValueChange={changeStep}
      orientation={vertical ? "vertical" : "horizontal"}
      indicators={{ completed: <Check className="size-3.5" /> }}
      className={cn(
        "min-h-full min-w-0 max-w-full",
        vertical ? "grid grid-cols-[12rem_minmax(0,1fr)]" : "flex flex-col",
      )}
    >
      {mobileSidebar ? (
        <CompactMobileStepperNav
          activeValue={activeValue}
          progressLabel={progressLabel}
          step={steps[currentStep] ?? steps[0]}
          total={steps.length}
        />
      ) : (
        <StepperNav
          aria-label={progressLabel}
          className={cn(
            vertical
              ? "sticky top-0 min-h-full w-full self-start border-r bg-muted/20 px-3 py-4"
              : "sticky top-0 z-20 w-full gap-0 overflow-x-auto border-b bg-background/95 px-3 py-3 [scrollbar-width:none] backdrop-blur-sm [&::-webkit-scrollbar]:hidden",
          )}
        >
          {steps.map((step, index) => (
            <StepperItem
              key={step.label}
              step={index + 1}
              disabled={index > currentStep || (!canNavigateBack && index !== currentStep)}
              className={cn(
                "relative justify-start",
                vertical
                  ? "min-h-[3.75rem] w-full items-start not-last:flex-none last:min-h-11"
                  : "min-w-28 items-center",
              )}
            >
              <StepperTrigger
                aria-current={index === currentStep ? "step" : undefined}
                className={cn(
                  "relative z-10 min-h-11 text-left transition-colors",
                  vertical
                    ? "w-full items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:bg-background/70 hover:text-foreground data-[state=active]:border-border/70 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    : "w-full flex-col gap-1.5 rounded-lg px-2 py-1 text-center hover:bg-background/70",
                )}
              >
                <StepperIndicator
                  className={cn(
                    "border-2 border-border bg-background font-mono text-[10px] text-muted-foreground",
                    vertical ? "size-5" : "size-7",
                    "data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary",
                    "data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground",
                  )}
                >
                  {index + 1}
                </StepperIndicator>
                <span className={cn("min-w-0", !vertical && "max-w-28")}>
                  <StepperTitle className="truncate text-sm data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground">
                    {step.label}
                  </StepperTitle>
                  {vertical ? (
                    <StepperDescription className="mt-0.5 text-[11px] leading-4 data-[state=inactive]:text-muted-foreground/65">
                      {step.description}
                    </StepperDescription>
                  ) : null}
                </span>
              </StepperTrigger>
              {index < steps.length - 1 ? (
                <StepperSeparator
                  className={cn(
                    "group-data-[state=completed]/step:bg-primary",
                    vertical
                      ? "absolute top-7 -bottom-4 left-4 h-auto w-px -translate-x-1/2"
                      : "absolute top-[1.375rem] left-[calc(50%+1rem)] h-px w-[calc(100%-2rem)] -translate-y-1/2",
                  )}
                />
              ) : null}
            </StepperItem>
          ))}
        </StepperNav>
      )}

      <StepperPanel className="min-w-0 bg-background">
        <StepperContent
          value={activeValue}
          className={cn("min-w-0", sidebar ? "p-4 sm:p-6" : "pt-6")}
        >
          {children}
        </StepperContent>
      </StepperPanel>
    </Stepper>
  );
}

function CompactMobileStepperNav({
  activeValue,
  progressLabel,
  step,
  total,
}: {
  activeValue: number;
  progressLabel: string;
  step: CreationStep | undefined;
  total: number;
}) {
  const percentage = total > 0 ? Math.round((activeValue / total) * 100) : 0;

  return (
    <StepperNav
      aria-label={progressLabel}
      className="sticky top-0 z-20 w-full border-b bg-background/95 px-4 py-3 backdrop-blur-sm"
    >
      <StepperItem step={activeValue} className="w-full justify-start">
        <StepperTrigger
          aria-current="step"
          className="min-h-14 w-full flex-col items-stretch gap-2 rounded-md px-0 text-left"
        >
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Step {activeValue} of {total}
              </span>
              <StepperTitle className="mt-1 truncate text-sm text-foreground">
                {step?.label ?? "Current step"}
              </StepperTitle>
              {step?.description ? (
                <StepperDescription className="mt-1 truncate text-[11px] leading-4">
                  {step.description}
                </StepperDescription>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-primary">
              {percentage}%
            </span>
          </span>
          <span
            role="progressbar"
            aria-label={`${progressLabel}: ${activeValue} of ${total}`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={activeValue}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              aria-hidden
              className="block h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${percentage}%` }}
            />
          </span>
        </StepperTrigger>
      </StepperItem>
    </StepperNav>
  );
}
