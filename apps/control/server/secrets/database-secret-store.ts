import { createHash } from "node:crypto";
import type { SecretStore } from "./secret-store";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { getControlConfig } from "../config/control-config";
import { encryptPlatformSecret, decryptPlatformSecret } from "../platform/platform-secret-crypto";

/** Persistent credentials for personal Projects; only opaque references leave storage. */
export class DatabaseSecretStore implements SecretStore {
  constructor(private readonly db: PrismaClient = prisma(), private readonly root = () => getControlConfig().auth.secret) {}
  referenceFor(projectId: string, resourceId: string) {
    return `db://${encodeURIComponent(projectId)}/${encodeURIComponent(resourceId)}`;
  }
  private key(projectId: string, resourceId: string) {
    return createHash("sha256").update(`personal-provider\0${projectId}\0${resourceId}\0${this.root()}`).digest("hex");
  }
  private parse(reference: string) {
    const match = /^db:\/\/([^/]+)\/([^/]+)$/.exec(reference);
    if (!match) throw new Error("Invalid managed credential reference.");
    return { projectId: decodeURIComponent(match[1]!), resourceId: decodeURIComponent(match[2]!) };
  }
  async put(projectId: string, resourceId: string, secret: string) {
    const ciphertext = encryptPlatformSecret(secret, this.key(projectId, resourceId));
    await this.db.managedSecretRecord.upsert({ where: { projectId_resourceId: { projectId, resourceId } }, create: { projectId, resourceId, ciphertext }, update: { ciphertext } });
    return this.referenceFor(projectId, resourceId);
  }
  async get(reference: string) {
    const key = this.parse(reference);
    const row = await this.db.managedSecretRecord.findUniqueOrThrow({ where: { projectId_resourceId: key } });
    return decryptPlatformSecret(row.ciphertext, this.key(key.projectId, key.resourceId));
  }
  async delete(reference: string) { await this.db.managedSecretRecord.deleteMany({ where: this.parse(reference) }); }
}
