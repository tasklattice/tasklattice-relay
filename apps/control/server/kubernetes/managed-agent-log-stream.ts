import { Writable } from "node:stream";
import {
  CoreV1Api,
  KubeConfig,
  Log,
  type V1Pod,
} from "@kubernetes/client-node";
import type {
  A2aAgentInstance,
  CreateInstanceLogSessionInput,
} from "@tali/contracts";
import { redactRuntimeDiagnostic } from "../instances/instance-http-view";

type ManagedAgentLogCoreApi = Pick<
  CoreV1Api,
  "readNamespacedPod" | "listNamespacedPod"
>;
type ManagedAgentLogApi = Pick<Log, "log">;

export interface ManagedAgentLogHandle {
  close(): void;
}

export interface ManagedAgentLogStreamCallbacks {
  onData(data: string): void;
  onError(error: Error): void;
  onEnd(): void;
}

function assertOwnedAgentPod(
  pod: V1Pod,
  projectId: string,
  instance: A2aAgentInstance,
): void {
  const annotations = pod.metadata?.annotations;
  if (
    annotations?.["tali.io/project-id"] !== projectId
    || annotations?.["tali.io/agent-id"] !== instance.agentId
    || annotations?.["tali.io/instance-id"] !== instance.id
    || pod.metadata?.labels?.["tali.io/runtime-kind"] !== "managed-a2a"
  ) {
    throw new Error(
      "Refusing to read Pod logs because the runtime ownership metadata does not match this Agent Instance.",
    );
  }
  if (!pod.spec?.containers.some((container) => container.name === "agent")) {
    throw new Error("The managed Agent Pod does not contain the expected agent container.");
  }
}

function assertOwnedProjectAgentPod(
  pod: V1Pod,
  projectId: string,
  agentId: string,
): void {
  const annotations = pod.metadata?.annotations;
  if (
    annotations?.["tali.io/project-id"] !== projectId
    || annotations?.["tali.io/agent-id"] !== agentId
    || pod.metadata?.labels?.["tali.io/runtime-kind"] !== "expert-agent-a2a"
  ) {
    throw new Error(
      "Refusing to read Pod logs because the Project Agent ownership metadata does not match.",
    );
  }
  if (!pod.spec?.containers.some((container) => container.name === "expert-agent")) {
    throw new Error("The Project Agent Pod does not contain the expected runtime container.");
  }
}

/**
 * Redacts complete log lines before forwarding them. The partial line buffer is
 * bounded so a malicious container cannot make the Control process retain an
 * unbounded amount of memory without printing a newline.
 */
class RedactingLogWritable extends Writable {
  private pending = "";

  constructor(private readonly callbacks: ManagedAgentLogStreamCallbacks) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    this.pending += chunk.toString();
    const lastNewline = this.pending.lastIndexOf("\n");
    if (lastNewline >= 0) {
      const completed = this.pending.slice(0, lastNewline + 1);
      this.pending = this.pending.slice(lastNewline + 1);
      for (const line of completed.split(/(?<=\n)/)) {
        if (line) this.callbacks.onData(redactRuntimeDiagnostic(line));
      }
    }
    if (this.pending.length > 64 * 1024) {
      this.callbacks.onData(redactRuntimeDiagnostic(this.pending));
      this.pending = "";
    }
    done();
  }

  override _final(done: (error?: Error | null) => void): void {
    if (this.pending) this.callbacks.onData(redactRuntimeDiagnostic(this.pending));
    this.pending = "";
    done();
  }
}

export class KubernetesManagedAgentLogStream {
  private readonly core: ManagedAgentLogCoreApi;
  private readonly logs: ManagedAgentLogApi;

  constructor(core?: ManagedAgentLogCoreApi, logs?: ManagedAgentLogApi) {
    if (core || logs) {
      if (!core || !logs) throw new Error("Core and Log Kubernetes clients are both required.");
      this.core = core;
      this.logs = logs;
      return;
    }
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromCluster();
    this.core = kubeConfig.makeApiClient(CoreV1Api);
    this.logs = new Log(kubeConfig);
  }

  async open(
    projectId: string,
    instance: A2aAgentInstance,
    options: CreateInstanceLogSessionInput,
    callbacks: ManagedAgentLogStreamCallbacks,
  ): Promise<ManagedAgentLogHandle> {
    const namespace = instance.runtimeNamespace;
    const podName = instance.podName;
    if (!namespace || !podName) {
      throw new Error("The managed A2A Agent has no active Kubernetes Pod.");
    }

    const pod = await this.core.readNamespacedPod({ name: podName, namespace });
    assertOwnedAgentPod(pod, projectId, instance);

    return this.openPod(
      namespace,
      podName,
      "agent",
      options,
      callbacks,
    );
  }

  async openProjectAgent(
    projectId: string,
    target: {
      agentId: string;
      namespace: string;
      workloadName: string;
    },
    options: CreateInstanceLogSessionInput,
    callbacks: ManagedAgentLogStreamCallbacks,
  ): Promise<ManagedAgentLogHandle> {
    const pods = await this.core.listNamespacedPod({
      namespace: target.namespace,
      labelSelector: `app.kubernetes.io/instance=${target.workloadName}`,
    });
    const pod = pods.items.find((item) => item.status?.phase === "Running")
      ?? pods.items[0];
    const podName = pod?.metadata?.name;
    if (!pod || !podName) {
      throw new Error("The Project Agent has no active Kubernetes Pod.");
    }
    assertOwnedProjectAgentPod(pod, projectId, target.agentId);
    return this.openPod(
      target.namespace,
      podName,
      "expert-agent",
      options,
      callbacks,
    );
  }

  private async openPod(
    namespace: string,
    podName: string,
    containerName: string,
    options: CreateInstanceLogSessionInput,
    callbacks: ManagedAgentLogStreamCallbacks,
  ): Promise<ManagedAgentLogHandle> {
    const stream = new RedactingLogWritable(callbacks);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      callbacks.onEnd();
    };
    stream.once("finish", end);
    stream.once("close", end);
    stream.once("error", (error) => callbacks.onError(error));

    const abort = await this.logs.log(namespace, podName, containerName, stream, {
      follow: true,
      previous: options.previous,
      tailLines: options.tailLines,
      timestamps: options.timestamps,
    });
    return {
      close() {
        abort.abort();
        stream.end();
      },
    };
  }
}
