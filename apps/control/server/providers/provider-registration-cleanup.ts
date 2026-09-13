import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { LiteLLMClient, type LiteLLMAdminClient } from "./litellm-client";
import { createSecretStore, type SecretStore } from "../secrets/secret-store";

// A full 100-model registration can take over an hour. Never hold a database
// connection while waiting for these external calls. Abandoned reservations
// become cleanup work; committing requires an unexpired reservation.
const reservationMs = 2 * 60 * 60 * 1_000;
const retryMs = 60_000;

export class ProviderRegistrationCleanup {
  constructor(
    private readonly db: PrismaClient,
    private readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
    private readonly secrets: SecretStore = createSecretStore(),
  ) {}

  async reserve(kind: "MODEL" | "SECRET", resourceId: string): Promise<string> {
    const id = randomUUID();
    await this.db.providerRegistrationCleanup.create({ data: {
      id, kind, resourceId, nextAttemptAt: new Date(Date.now() + reservationMs),
    } });
    return id;
  }

  async commit(transaction: Prisma.TransactionClient, ids: string[]): Promise<void> {
    const result = await transaction.providerRegistrationCleanup.deleteMany({
      where: { id: { in: ids }, attempts: 0, nextAttemptAt: { gt: new Date() } },
    });
    if (result.count !== ids.length) throw new Error("Provider registration expired. Retry the registration.");
  }

  async renew(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const result = await this.db.providerRegistrationCleanup.updateMany({
      where: { id: { in: ids }, attempts: 0, nextAttemptAt: { gt: new Date() } },
      data: { nextAttemptAt: new Date(Date.now() + reservationMs) },
    });
    if (result.count !== ids.length) throw new Error("Provider registration expired. Retry the registration.");
  }

  async rollback(ids: string[], deferred = false): Promise<void> {
    if (!ids.length) return;
    // A timed-out create may still complete remotely. Delay its cleanup past
    // the request timeout instead of treating an immediate 404 as definitive.
    await this.db.providerRegistrationCleanup.updateMany({
      where: { id: { in: ids } },
      data: { nextAttemptAt: new Date(Date.now() + (deferred ? retryMs : 0)) },
    });
    if (!deferred) await this.drain(new Date(), ids);
  }

  async drain(now = new Date(), ids?: string[]): Promise<number> {
    const tasks = await this.db.providerRegistrationCleanup.findMany({
      where: { nextAttemptAt: { lte: now }, ...(ids ? { id: { in: ids } } : {}) },
      // Bound external requests so an unavailable gateway does not consume
      // the maintenance job's five-minute execution budget.
      orderBy: { nextAttemptAt: "asc" }, take: 5,
    });
    let completed = 0;
    for (const task of tasks) {
      const lease = new Date(now.getTime() + retryMs);
      const claimed = await this.db.providerRegistrationCleanup.updateMany({
        where: { id: task.id, nextAttemptAt: task.nextAttemptAt, attempts: task.attempts },
        data: { nextAttemptAt: lease, attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        if (task.kind === "MODEL") await this.litellm.deleteModelById(task.resourceId);
        else if (task.kind === "SECRET") await this.secrets.delete(task.resourceId);
        else throw new Error("Unknown Provider cleanup resource kind.");
        await this.db.providerRegistrationCleanup.deleteMany({
          where: { id: task.id, nextAttemptAt: lease, attempts: task.attempts + 1 },
        });
        completed += 1;
      } catch {
        // Keep the durable reservation. Maintenance retries it after the
        // lease expires; remote error bodies may contain Provider credentials.
        console.error("Provider registration cleanup will retry", { id: task.id, kind: task.kind });
      }
    }
    return completed;
  }
}
