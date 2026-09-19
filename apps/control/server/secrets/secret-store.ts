import { kubernetesResourceName } from "@tali/contracts/resource-identity";
import { readFile } from "node:fs/promises";

export interface SecretStore {
  referenceFor(projectId: string, resourceId: string): string;
  put(projectId: string, resourceId: string, secret: string): Promise<string>;
  get(reference: string): Promise<string>;
  delete(reference: string): Promise<void>;
}

const memorySecrets = new Map<string, string>();

function kubernetesSlug(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function kubernetesSecretName(projectId: string, resourceId: string): string {
  return kubernetesResourceName("secret", JSON.stringify([projectId, resourceId]));
}

export function kubernetesSecretLabels(
  projectId: string,
  resourceId: string,
): Record<string, string> {
  return {
    "app.kubernetes.io/managed-by": "tali",
    "tali.io/project-id": kubernetesSlug(projectId, "project").slice(0, 63),
    "tali.io/resource-id": kubernetesSlug(resourceId, "resource").slice(0, 63),
  };
}

export class DevelopmentSecretStore implements SecretStore {
  referenceFor(projectId: string, resourceId: string): string {
    return `memory://${projectId}/${resourceId}`;
  }
  async put(
    projectId: string,
    resourceId: string,
    secret: string,
  ): Promise<string> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Secret storage failed: Kubernetes Secret storage is required in production.",
      );
    }
    const reference = this.referenceFor(projectId, resourceId);
    memorySecrets.set(reference, secret);
    return reference;
  }

  async get(reference: string): Promise<string> {
    const secret = memorySecrets.get(reference);
    if (!secret) {
      throw new Error(
        "Managed credential is unavailable from the development secret store.",
      );
    }
    return secret;
  }

  async delete(reference: string): Promise<void> {
    memorySecrets.delete(reference);
  }
}

export class KubernetesSecretStore implements SecretStore {
  private readonly namespace = process.env.POD_NAMESPACE ?? "tali";
  private readonly api = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443"}`;
  private token?: string;

  referenceFor(projectId: string, resourceId: string): string {
    return `k8s://${this.namespace}/${kubernetesSecretName(projectId, resourceId)}#CREDENTIAL`;
  }

  async put(
    projectId: string,
    resourceId: string,
    secret: string,
  ): Promise<string> {
    const name = kubernetesSecretName(projectId, resourceId);
    const path = `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/secrets/${encodeURIComponent(name)}`;
    const body = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace: this.namespace,
        labels: kubernetesSecretLabels(projectId, resourceId),
      },
      type: "Opaque",
      data: { CREDENTIAL: Buffer.from(secret).toString("base64") },
    };
    const current = await this.request(path, { method: "GET" }, true);
    await this.request(
      current
        ? path
        : `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/secrets`,
      {
        method: current ? "PUT" : "POST",
        body: JSON.stringify({
          ...body,
          ...(current && typeof current === "object" && "metadata" in current
            ? {
                metadata: {
                  ...body.metadata,
                  resourceVersion: (
                    current as { metadata?: { resourceVersion?: string } }
                  ).metadata?.resourceVersion,
                },
              }
            : {}),
        }),
      },
    );
    return this.referenceFor(projectId, resourceId);
  }

  async get(reference: string): Promise<string> {
    const match = reference.match(/^k8s:\/\/([^/]+)\/([^#]+)#(.+)$/);
    if (!match) throw new Error("Invalid Kubernetes Secret reference.");
    const [, namespace, name, key] = match;
    const resource = await this.request(
      `/api/v1/namespaces/${encodeURIComponent(namespace!)}/secrets/${encodeURIComponent(name!)}`,
      { method: "GET" },
    );
    const encoded = (resource as { data?: Record<string, string> }).data?.[
      key!
    ];
    if (!encoded)
      throw new Error("Managed credential is missing from Kubernetes Secret.");
    return Buffer.from(encoded, "base64").toString("utf8");
  }

  async delete(reference: string): Promise<void> {
    const match = reference.match(/^k8s:\/\/([^/]+)\/([^#]+)#/);
    if (!match) return;
    await this.request(
      `/api/v1/namespaces/${encodeURIComponent(match[1]!)}/secrets/${encodeURIComponent(match[2]!)}`,
      { method: "DELETE" },
      true,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<unknown> {
    this.token ??= (
      await readFile(
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
        "utf8",
      )
    ).trim();
    const response = await fetch(`${this.api}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (allowNotFound && response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(
        `Secret storage failed: Kubernetes API returned ${response.status}.`,
      );
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}

export function createSecretStore(): SecretStore {
  return process.env.KUBERNETES_SERVICE_HOST
    ? new KubernetesSecretStore()
    : new DevelopmentSecretStore();
}
