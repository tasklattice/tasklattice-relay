import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

const defaultRuntimeNamespacesConfig = {
  enabled: false,
  cluster_id: "in-cluster",
};

const runtimeNamespacesConfigSchema = z.object({
  enabled: z.boolean(),
  cluster_id: z.string().trim().min(1).max(120),
});

const localAuthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  initial_platform_administrator_username: z.string().trim().min(1),
  initial_platform_administrator_email: z.string().email(),
  initial_platform_administrator_password: z.string().min(1).max(128),
}).strict();

const memoryConfig = z.object({
  enabled: z.boolean().default(true),
  projectAllowlist: z.array(z.string().min(1)).default([]),
  baseUrl: z.string().url().default("http://localhost:8888"),
  apiKey: z.string().default(""),
  routerToken: z.string().default(""),
  embeddingDimensions: z.number().int().positive().default(1536),
  recallTimeoutMs: z.number().int().min(100).max(8000).default(1500),
}).strict();

const controlConfigSchema = z.object({
  schema_version: z.literal(1),
  server: z.object({
    public_url: z.string().url().optional(),
    internal_url: z.string().url().optional(),
  }),
  database: z.object({
    url: z.string().trim().min(1),
  }),
  auth: z.object({
    secret: z.string().min(32),
    local: localAuthConfigSchema,
  }).superRefine((value, context) => {
    if (
      value.local.enabled &&
      (!value.local.initial_platform_administrator_username ||
        !value.local.initial_platform_administrator_email ||
        !value.local.initial_platform_administrator_password)
    ) {
      context.addIssue({
        code: "custom",
        path: ["local"],
        message:
          "Local authentication requires the initial Platform Administrator username, email, and password.",
      });
    }
  }),
  // Bootstrap only: persisted Platform Settings remain authoritative.
  runner: z.object({
    url: z.string().url(),
    token: z.string().min(1),
  }).optional(),
  litellm: z.object({
    url: z.string().url(),
    master_key: z.string(),
  }).optional(),
  memory: memoryConfig.prefault({}),
  metrics: z.object({ token: z.string().default("") }).strict().prefault({}),
  demo: z.object({ image: z.string().default("") }).strict().prefault({}),
  runtime_namespaces: runtimeNamespacesConfigSchema.default(
    defaultRuntimeNamespacesConfig,
  ),
}).strict().superRefine((value, context) => {
  if (!value.server.public_url) {
    context.addIssue({
      code: "custom",
      path: ["server", "public_url"],
      message: "server.public_url is required for Better Auth.",
    });
  }
});

export type ControlConfig = z.infer<typeof controlConfigSchema>;

declare global {
  var taliControlConfig: ControlConfig | undefined;
}

const developmentConfig: ControlConfig = controlConfigSchema.parse({
  schema_version: 1,
  server: {
    public_url: "http://localhost:5173",
  },
  database: {
    url: "postgresql://tali:development@127.0.0.1:5432/tali",
  },
  auth: {
    secret: "tali-local-development-secret-32-chars",
    local: {
      enabled: true,
      initial_platform_administrator_username: "admin",
      initial_platform_administrator_email: "admin@tasklattice.local",
      initial_platform_administrator_password: "password",
    },
  },
  runner: {
    url: "http://127.0.0.1:9090",
    token: "local-dev-token",
  },
  litellm: {
    url: "http://127.0.0.1:4000",
    master_key: "",
  },
  runtime_namespaces: defaultRuntimeNamespacesConfig,
});

export function getControlConfig(): ControlConfig {
  if (globalThis.taliControlConfig) {
    return globalThis.taliControlConfig;
  }
  const configuredPath = process.env.TALI_CONFIG;
  if (!configuredPath) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "TALI_CONFIG must point to the Control Plane TOML file in production.",
      );
    }
    globalThis.taliControlConfig = structuredClone(developmentConfig);
    return globalThis.taliControlConfig;
  }
  const path = resolve(configuredPath);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read TaskLattice Relay configuration at ${path}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  const result = controlConfigSchema.safeParse(parse(raw));
  if (!result.success) {
    throw new Error(
      `Invalid TaskLattice Relay configuration at ${path}: ${z.prettifyError(result.error)}`,
    );
  }
  globalThis.taliControlConfig = result.data;
  return result.data;
}

export function setControlConfigForTests(
  config: ControlConfig | undefined,
): void {
  globalThis.taliControlConfig = config;
}

export function developmentControlConfig(): ControlConfig {
  return structuredClone(developmentConfig);
}
