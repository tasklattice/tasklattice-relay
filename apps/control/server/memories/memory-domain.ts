import type { MemoryBindingStatus, MemoryStatus } from "@tali/contracts";

const memoryTransitions: Readonly<Record<MemoryStatus, ReadonlySet<MemoryStatus>>> = {
  provisioning: new Set(["ready", "degraded", "deleting"]),
  ready: new Set(["degraded", "unbound", "deleting"]),
  degraded: new Set(["ready", "unbound", "deleting"]),
  unbound: new Set(["ready", "degraded", "deleting"]),
  deleting: new Set(["deletion_failed", "deleted"]),
  deletion_failed: new Set(["deleting"]),
  deleted: new Set(),
};

const bindingTransitions: Readonly<
  Record<MemoryBindingStatus, ReadonlySet<MemoryBindingStatus>>
> = {
  pending: new Set(["active", "detached"]),
  active: new Set(["detached"]),
  detached: new Set(),
};

export class InvalidMemoryTransitionError extends Error {
  readonly domain: "memory" | "binding";
  readonly from: MemoryStatus | MemoryBindingStatus;
  readonly to: MemoryStatus | MemoryBindingStatus;

  constructor(input: {
    domain: "memory" | "binding";
    from: MemoryStatus | MemoryBindingStatus;
    to: MemoryStatus | MemoryBindingStatus;
  }) {
    super(`Cannot transition ${input.domain} from ${input.from} to ${input.to}.`);
    this.name = "InvalidMemoryTransitionError";
    this.domain = input.domain;
    this.from = input.from;
    this.to = input.to;
  }
}

export interface DomainTransition<T> {
  from: T;
  to: T;
  changed: boolean;
  event: {
    type: "memory.status_changed" | "memory_binding.status_changed";
    from: T;
    to: T;
  } | null;
}

export function transitionMemoryStatus(
  from: MemoryStatus,
  to: MemoryStatus,
): DomainTransition<MemoryStatus> {
  if (from === to) return { from, to, changed: false, event: null };
  if (!memoryTransitions[from].has(to)) {
    throw new InvalidMemoryTransitionError({ domain: "memory", from, to });
  }
  return {
    from,
    to,
    changed: true,
    event: { type: "memory.status_changed", from, to },
  };
}

export function transitionMemoryBindingStatus(
  from: MemoryBindingStatus,
  to: MemoryBindingStatus,
): DomainTransition<MemoryBindingStatus> {
  if (from === to) return { from, to, changed: false, event: null };
  if (!bindingTransitions[from].has(to)) {
    throw new InvalidMemoryTransitionError({ domain: "binding", from, to });
  }
  return {
    from,
    to,
    changed: true,
    event: { type: "memory_binding.status_changed", from, to },
  };
}
