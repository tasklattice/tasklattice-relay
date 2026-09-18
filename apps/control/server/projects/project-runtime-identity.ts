import { createHash } from "node:crypto";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const PROJECT_RUNTIME_IDENTIFIER_BYTES = 10;

export const OPENSHELL_ROUTABLE_NAME_MAX_LENGTH = 19;
export const PROJECT_RUNTIME_NAMESPACE_PREFIX = "tp-";

function encodeBase32(input: Uint8Array): string {
  let accumulator = 0;
  let bits = 0;
  let result = "";
  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(accumulator >> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  return result;
}

export function projectRuntimeNamespace(projectId: string): string {
  // Ten SHA-256 bytes encode to exactly 16 lowercase Base32 characters. With
  // the fixed prefix the result is a 19-character DNS-1123 label that can be
  // used unchanged as an OpenShell workspace, namespace, or route segment.
  const identifier = encodeBase32(
    createHash("sha256")
      .update(projectId)
      .digest()
      .subarray(0, PROJECT_RUNTIME_IDENTIFIER_BYTES),
  );
  return `${PROJECT_RUNTIME_NAMESPACE_PREFIX}${identifier}`;
}

