import { useEffect, useRef, useState } from "react";
import { FitAddon, init, Terminal } from "ghostty-web";
import { RefreshCw, Radio, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  acquireTerminalSession,
  releaseTerminalSession,
  resetTerminalSession,
  type TerminalSession,
  type TerminalSessionEvent,
} from "@/lib/terminal-session";

let ghosttyInitialization: Promise<void> | undefined;

function initializeGhostty(): Promise<void> {
  ghosttyInitialization ??= init().catch((error: unknown) => {
    ghosttyInitialization = undefined;
    throw error;
  });
  return ghosttyInitialization;
}

type ConnectionState = "connecting" | "connected" | "closed" | "error";

export function AgentLiveLogs({
  instanceId,
  podName,
}: {
  instanceId: string;
  podName: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState("Opening Kubernetes Pod log stream…");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const sessionKey = `agent-logs/${instanceId}`;
    if (attempt > 0) resetTerminalSession(sessionKey);
    setState("connecting");
    setMessage("Opening Kubernetes Pod log stream…");
    let disposed = false;
    let terminal: Terminal | undefined;
    let session: TerminalSession | undefined;
    let listener: ((event: TerminalSessionEvent) => void) | undefined;

    const start = async () => {
      try {
        await initializeGhostty();
        if (disposed) return;
        const opened = new Terminal({
          convertEol: true,
          cursorBlink: false,
          fontSize: 12,
          fontFamily:
            '"SFMono-Regular", "Cascadia Code", "Roboto Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
          scrollback: 10_000,
          theme: {
            background: "#0b0f0e",
            foreground: "#d8e0db",
            cursor: "#0b0f0e",
            selectionBackground: "#36531499",
          },
        });
        terminal = opened;
        const fit = new FitAddon();
        opened.loadAddon(fit);
        opened.open(element);
        element.setAttribute(
          "aria-label",
          `Read-only live stdout and stderr logs for Pod ${podName}`,
        );
        fit.fit();
        fit.observeResize();

        session = await acquireTerminalSession(sessionKey, async () => {
          const created = await api.createInstanceLogSession(instanceId, {
            tailLines: 300,
            timestamps: true,
            previous: false,
          });
          const protocol = location.protocol === "https:" ? "wss:" : "ws:";
          return `${protocol}//${location.host}${created.websocketUrl}`;
        });
        if (disposed) {
          releaseTerminalSession(sessionKey);
          return;
        }
        listener = (event) => {
          if (disposed) return;
          if (event.type === "open") {
            setState("connected");
            setMessage("Following stdout and stderr");
          } else if (event.type === "message") {
            opened.write(event.data);
          } else if (event.type === "close") {
            setState("closed");
            setMessage(event.event.reason || "Log stream ended");
          } else if (event.type === "error") {
            setState("error");
            setMessage("Unable to connect to the live log stream");
          }
        };
        session.listeners.add(listener);
        if (session.buffer.length) {
          opened.write(session.buffer.join(""));
          session.buffer.length = 0;
        }
        if (session.connected) {
          setState("connected");
          setMessage("Following stdout and stderr");
        }
      } catch (error) {
        if (disposed) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Live logs unavailable");
      }
    };
    void start();
    return () => {
      disposed = true;
      if (session && listener) session.listeners.delete(listener);
      releaseTerminalSession(sessionKey);
      terminal?.dispose();
    };
  }, [attempt, instanceId, podName]);

  const active = state === "connecting" || state === "connected";
  return (
    <div className="overflow-hidden rounded-lg border bg-[#0b0f0e]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#111715] px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="border-white/15 bg-white/5 text-white">
            <Radio className={active ? "text-emerald-400" : "text-amber-400"} />
            {state === "connected" ? "Live" : state}
          </Badge>
          <span className="truncate font-mono text-xs text-white/65">{podName} / agent</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-white/55 sm:flex">
            <ShieldCheck className="size-3.5" /> Read-only · secrets redacted
          </span>
          {state === "closed" || state === "error" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw /> Reconnect
            </Button>
          ) : null}
        </div>
      </div>
      <div ref={host} className="h-[34rem] overflow-hidden p-3" />
      <p role="status" className="border-t border-white/10 px-4 py-2 text-[11px] text-white/55">
        {message}. Input is disabled; this view follows Kubernetes Pod stdout/stderr only.
      </p>
    </div>
  );
}
