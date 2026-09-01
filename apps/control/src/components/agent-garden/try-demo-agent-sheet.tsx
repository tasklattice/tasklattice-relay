import { useEffect, useState } from "react";
import type { AgentGardenEntry } from "@tali/contracts";
import {
  CheckCircle2,
  LoaderCircle,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { AgentGardenIcon } from "./agent-garden-icon";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createUuid } from "@/lib/uuid";

interface DemoResult {
  executionRuntime: string;
  runtimeLogs: string[];
  simulatedBehavior: boolean;
  output: string;
  trace: string[];
}

export function TryDemoAgentSheet({
  agent,
  onOpenChange,
  open,
}: {
  agent: AgentGardenEntry | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const suggestions = agent
    ? [
        agent.configuration.examplePrompt1,
        agent.configuration.examplePrompt2,
      ].filter((value): value is string => Boolean(value))
    : [];
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<DemoResult>();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrompt(suggestions[0] ?? "");
    setResult(undefined);
    setError("");
  }, [agent?.id, open]);

  const run = async () => {
    if (!agent || !prompt.trim()) return;
    setRunning(true);
    setError("");
    setResult(undefined);
    try {
      const response = await fetch(
        `/api/v1/demo-agents/${encodeURIComponent(agent.id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: createUuid(),
            method: "SendMessage",
            params: {
              message: {
                messageId: createUuid(),
                role: "ROLE_USER",
                parts: [{ text: prompt.trim() }],
              },
            },
          }),
        },
      );
      const payload = await response.json() as {
        detail?: string;
        result?: {
          message?: {
            metadata?: {
              executionRuntime?: string;
              runtimeLogs?: string[];
              simulatedBehavior?: boolean;
              trace?: string[];
            };
            parts?: Array<{ text?: string }>;
          };
        };
      };
      if (!response.ok) {
        throw new Error(payload.detail ?? "The demo Agent did not respond.");
      }
      const output = payload.result?.message?.parts?.find(
        (part) => typeof part.text === "string",
      )?.text;
      if (!output) throw new Error("The demo Agent returned no text.");
      setResult({
        executionRuntime:
          payload.result?.message?.metadata?.executionRuntime
          ?? "UNKNOWN",
        runtimeLogs:
          payload.result?.message?.metadata?.runtimeLogs
          ?? [],
        simulatedBehavior:
          payload.result?.message?.metadata?.simulatedBehavior
          ?? true,
        output,
        trace: payload.result?.message?.metadata?.trace ?? [],
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "The demo Agent did not respond.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <EntitySheet
      open={open && Boolean(agent)}
      onOpenChange={onOpenChange}
      eyebrow="Interaction preview"
      title={agent?.name ?? "Try Agent"}
      description="Send one task through the Agent's advertised interface and inspect the returned path."
      width="lg"
      footer={(
        <>
          <Button
            type="button"
            variant="outline"
            disabled={running}
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={!prompt.trim() || running}
            onClick={() => void run()}
          >
            {running ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Send />
            )}
            {running ? "Running preview…" : "Send task"}
          </Button>
        </>
      )}
    >
      {agent ? (
        <div className="space-y-6">
          <div className="flex items-start gap-4 border bg-muted/20 p-4">
            <AgentGardenIcon
              type={agent.integrationType}
              catalogIcon={agent.configuration.icon}
              className="size-12"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="secondary"
                  className="bg-primary/8 text-primary"
                >
                  {agent.platformLabel}
                </Badge>
                <Badge variant="outline">Demo</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {agent.description}
              </p>
            </div>
          </div>

          <p className="border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
            <strong className="block text-foreground">
              Safe interaction sample
            </strong>
            The response and execution trace use deterministic sample data.
            {agent.configuration.framework === "LangGraph"
              ? " The workflow itself runs on a real LangGraph StateGraph."
              : ""} No repository, ticket, or external Agent is read or changed.
          </p>

          <section className="space-y-3">
            <div>
              <label
                htmlFor="demo-agent-prompt"
                className="text-sm font-semibold"
              >
                Task
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                This is sent as an A2A 1.0 JSON-RPC{" "}
                <code className="font-mono">SendMessage</code> request.
              </p>
            </div>
            <Textarea
              id="demo-agent-prompt"
              className="min-h-28 resize-y leading-6"
              maxLength={4_000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {suggestions.length ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left text-xs"
                    onClick={() => setPrompt(suggestion)}
                  >
                    <Sparkles className="size-3.5" />
                    {suggestion}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>

          {running ? (
            <div
              role="status"
              className="grid min-h-44 place-items-center border border-dashed"
            >
              <span className="text-center text-sm text-muted-foreground">
                <LoaderCircle className="mx-auto mb-3 size-5 animate-spin text-primary motion-reduce:animate-none" />
                Sending task to {agent.name}…
              </span>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {result ? (
            <section
              className="space-y-4"
              aria-live="polite"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Completed</h3>
                <Badge variant="outline" className="ml-auto">
                  {result.simulatedBehavior ? "Sample runtime" : "Real StateGraph"}
                </Badge>
              </div>
              {result.trace.length ? (
                <ol className="grid gap-2 sm:grid-cols-4">
                  {result.trace.map((step, index) => (
                    <li
                      key={`${step}-${index}`}
                      className="relative border bg-muted/15 px-3 py-3 text-xs"
                    >
                      <span className="mb-2 grid size-5 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="border bg-card">
                <div className="flex min-h-11 items-center gap-2 border-b px-4 text-xs font-semibold">
                  <Play className="size-3.5 text-primary" />
                  Agent response
                </div>
                <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-sm leading-6 text-foreground">
                  {result.output}
                </pre>
              </div>
              {result.runtimeLogs.length ? (
                <div className="overflow-hidden border bg-[#0b0f0e] text-white">
                  <div className="flex min-h-11 items-center gap-2 border-b border-white/10 px-4 text-xs font-semibold">
                    <Play className="size-3.5 text-emerald-400" />
                    Runtime logs
                    <Badge
                      variant="outline"
                      className="ml-auto border-white/15 bg-white/5 font-mono text-[10px] text-white/70"
                    >
                      {result.executionRuntime}
                    </Badge>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-4 py-4 font-mono text-[11px] leading-5 text-white/70">
                    {result.runtimeLogs.join("\n")}
                  </pre>
                  <p className="border-t border-white/10 px-4 py-2 text-[11px] text-white/50">
                    Structured preview logs omit prompt text and credentials.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </EntitySheet>
  );
}
