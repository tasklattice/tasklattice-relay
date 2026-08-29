import {
  HindsightMemoryProvider,
  type HindsightMemoryProviderOptions,
} from "./hindsight-memory-provider";
import type { MemoryProvider } from "./memory-provider";

export interface MemoryProviderFactoryOptions {
  provider?: string;
  hindsight?: HindsightMemoryProviderOptions;
}

/**
 * Production provider boundary. V1 deliberately supports only the reviewed,
 * self-hosted Hindsight adapter; the Fake provider remains test-only.
 */
export function createMemoryProvider(
  options: MemoryProviderFactoryOptions = {},
): MemoryProvider {
  const provider = options.provider ?? process.env.TALI_MEMORY_PROVIDER ?? "hindsight";
  if (provider !== "hindsight") {
    throw new Error(`Unsupported Memory provider configuration: ${provider}.`);
  }
  return new HindsightMemoryProvider(options.hindsight);
}
