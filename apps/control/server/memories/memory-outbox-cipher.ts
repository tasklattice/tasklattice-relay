import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function keyFor(secret: string, projectId: string): Buffer {
  if (secret.length < 32) {
    throw new Error("The Memory outbox encryption secret must contain at least 32 characters.");
  }
  return createHmac("sha256", secret)
    .update("tasklattice-memory-outbox\0")
    .update(projectId)
    .digest();
}

function associatedData(memoryId: string, idempotencyKey: string): Buffer {
  return Buffer.from(`${VERSION}\0${memoryId}\0${idempotencyKey}`, "utf8");
}

/** AES-256-GCM envelope used only for short-lived retain payloads in Relay DB. */
export class MemoryOutboxCipher {
  constructor(
    private readonly projectId: string,
    private readonly secret: () => string,
  ) {}

  encrypt(value: unknown, memoryId: string, idempotencyKey: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyFor(this.secret(), this.projectId), iv);
    cipher.setAAD(associatedData(memoryId, idempotencyKey));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt<T>(envelope: string, memoryId: string, idempotencyKey: string): T {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
      envelope.split(".");
    if (
      version !== VERSION
      || !encodedIv
      || !encodedTag
      || !encodedCiphertext
      || extra !== undefined
    ) {
      throw new Error("The Memory outbox payload envelope is invalid.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(this.secret(), this.projectId),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(associatedData(memoryId, idempotencyKey));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }
}
