import { createHash, randomUUID } from "node:crypto";

export const KUBERNETES_RESOURCE_ID_LENGTH = 16;
export const RESOURCE_HASH_LENGTH = 13;
export const resourcePrefixes = {
  project: "tp",
  instance: "ti",
  secret: "ts",
  credential: "tc",
} as const;

export type KubernetesResourceType = keyof typeof resourcePrefixes;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Stable DNS label; canonical IDs are reused rather than hashed a second time. */
export function kubernetesResourceName(type: KubernetesResourceType, identity: string): string {
  if (!identity) throw new Error("Resource identity must not be empty.");
  const prefix = resourcePrefixes[type];
  if (new RegExp(`^${prefix}-[a-z2-7]{${RESOURCE_HASH_LENGTH}}$`).test(identity)) return identity;
  const digest = createHash("sha256").update(identity).digest();
  let bits = 0;
  let accumulator = 0;
  let hash = "";
  for (const byte of digest) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5 && hash.length < RESOURCE_HASH_LENGTH) {
      bits -= 5;
      hash += BASE32[(accumulator >> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
    if (hash.length === RESOURCE_HASH_LENGTH) break;
  }
  return `${prefix}-${hash}`;
}

/** Allocate once, then persist and reuse the ID across Worker retries. */
export function generateKubernetesResourceId(type: KubernetesResourceType): string {
  return kubernetesResourceName(type, randomUUID());
}
