import { CoreV1Api, KubeConfig, type V1Secret, type V1ServiceAccount } from "@kubernetes/client-node";
import { PromiseMiddlewareWrapper } from "@kubernetes/client-node/dist/gen/middleware.js";
import { getWorkerConfig, type WorkerConfig } from "../config/worker-config";
import { namespaceOwner } from "./project-resource-ownership";

type PullSecret = { name: string };
type Target = { namespace: string; projectId: string; assertCurrent?: () => Promise<void> };
type Core = Pick<CoreV1Api, "readNamespace" | "readNamespacedServiceAccount" | "createNamespacedServiceAccount" | "readNamespacedSecret">;
class ImagePullPreparationError extends Error {}
export function projectPullServiceAccounts(serviceName: string) {
  if (!/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(serviceName) || serviceName.length > 63) {
    throw new Error("Invalid Project OpenShell service name.");
  }
  return {
    gateway: serviceName,
    sandbox: `${serviceName}-sandbox`.slice(0, 63).replace(/-$/, ""),
    certgen: `${serviceName}-certgen`,
  };
}

function status(error: unknown): number {
  return Number((error as { code?: unknown; statusCode?: unknown })?.code
    ?? (error as { statusCode?: unknown })?.statusCode);
}

/** Complete registry references only. Never reinterpret an external registry or a short name. */
export function validateProjectImageSources(images: string[], config = getWorkerConfig().openshift): string[] {
  if (!config.enabled) return [];
  const hosts = new Set<string>();
  for (const image of images) {
    const [host, source] = image.split("/");
    const internal = host === config.imageRegistryHost
      || /^image-registry\.openshift-image-registry\.svc(?:\.cluster\.local)?:5000$/.test(host ?? "");
    if (!internal) continue;
    if (source !== config.imageSourceNamespace || image.split("/").length !== 3) {
      throw new Error(`OpenShift image source mismatch: image=${image}, authorized source=${config.imageSourceNamespace}. Configure the image URL and imageSourceNamespace together.`);
    }
    hosts.add(host!);
  }
  return [...hosts];
}

// Inspect registry keys only; credentials and Secret bodies must never enter errors/logs.
function registryKeys(secret: V1Secret): string[] {
  try {
    if (secret.type === "kubernetes.io/dockerconfigjson") {
      const parsed = JSON.parse(Buffer.from(secret.data?.[".dockerconfigjson"] ?? "", "base64").toString());
      return Object.keys(parsed.auths ?? {});
    }
    if (secret.type === "kubernetes.io/dockercfg") {
      return Object.keys(JSON.parse(Buffer.from(secret.data?.[".dockercfg"] ?? "", "base64").toString()));
    }
  } catch { /* An incomplete controller-populated Secret is retried within the deadline. */ }
  return [];
}

// Kubernetes accepts registry host globs and repository path prefixes in pull secrets.
function keyMatchesImage(key: string, image: string): boolean {
  const normalized = key.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const [pattern, ...scope] = normalized.split("/");
  const [host, ...repository] = image.split("/");
  if (!pattern || !host) return false;
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]*");
  return new RegExp(`^${escaped}$`).test(host)
    && (!scope.length || repository.join("/").startsWith(scope.join("/")));
}

export class ProjectImagePullReadiness {
  constructor(
    private readonly core: Core,
    private readonly config: WorkerConfig["openshift"],
    private readonly now = Date.now,
    private readonly sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}

  async prepare(target: Target, accounts: Array<{
    name: string; managed: boolean; images: string[]; secrets: PullSecret[]; release?: string; hook?: boolean;
  }>): Promise<PullSecret[][]> {
    if (!this.config.enabled) return accounts.map((a) => a.secrets);
    // Validate all addresses before creating any ServiceAccounts.
    const hosts = accounts.map((a) => validateProjectImageSources(a.images, this.config));
    const deadline = this.now() + (this.config.imagePullReadyTimeoutMs ?? 120000);
    const options = () => ({ middleware: [new PromiseMiddlewareWrapper({
      pre: async (context) => {
        context.setSignal(AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - this.now()))));
        return context;
      }, post: async (context) => context,
    })] });
    let ownerUid: string | undefined;
    const results: PullSecret[][] = [];
    for (const [index, account] of accounts.entries()) {
      let pending = "ServiceAccount is not ready";
      for (;;) {
        await target.assertCurrent?.();
        if (this.now() >= deadline) {
          throw new Error(`OpenShift image pull readiness timed out: namespace=${target.namespace}, SA=${account.name}: ${pending}`);
        }
        try {
          const namespace = await this.core.readNamespace({ name: target.namespace }, options());
          let owner: ReturnType<typeof namespaceOwner>;
          try { owner = namespaceOwner(namespace, target.projectId); }
          catch { throw new ImagePullPreparationError("Project Namespace ownership is missing, mismatched, or being deleted."); }
          if (ownerUid && ownerUid !== owner.uid) throw new ImagePullPreparationError("Project Namespace was recreated during image pull preparation.");
          ownerUid = owner.uid;
          let sa: V1ServiceAccount | undefined;
          try {
            sa = await this.core.readNamespacedServiceAccount({ namespace: target.namespace, name: account.name }, options());
          } catch (error) {
            if (status(error) !== 404) throw error;
            if (account.managed) {
              try {
                await this.core.createNamespacedServiceAccount({ namespace: target.namespace, body: {
                  apiVersion: "v1", kind: "ServiceAccount",
                  metadata: { name: account.name, namespace: target.namespace,
                    labels: { "app.kubernetes.io/managed-by": account.release && !account.hook ? "Helm" : "tali" },
                    annotations: { "tali.io/project-id": target.projectId,
                      ...(account.release ? {
                        "meta.helm.sh/release-name": account.release,
                        "meta.helm.sh/release-namespace": target.namespace,
                      } : {}),
                    }, ownerReferences: [owner] },
                } }, options());
              } catch (createError) { if (status(createError) !== 409) throw createError; }
            }
          }
          if (sa) {
            if (sa.metadata?.deletionTimestamp) throw new ImagePullPreparationError(`ServiceAccount ${account.name} is being deleted.`);
            if (account.managed) {
              const annotations = sa.metadata?.annotations ?? {};
              const labels = sa.metadata?.labels ?? {};
              const owned = sa.metadata?.ownerReferences?.some((ref) => ref.apiVersion === "v1"
                && ref.kind === "Namespace" && ref.name === owner.name && ref.uid === owner.uid);
              // Existing chart-owned accounts keep their names, preserving SCC grants and Sandbox CRs.
              // A hook from an interrupted initial install may not yet have its Namespace owner.
              const legacy = account.release && (account.hook
                ? labels["app.kubernetes.io/instance"] === account.release
                  && labels["app.kubernetes.io/name"] === "openshell"
                  && annotations["helm.sh/hook"] === "pre-install,pre-upgrade"
                : labels["app.kubernetes.io/managed-by"] === "Helm"
                  && annotations["meta.helm.sh/release-name"] === account.release
                  && annotations["meta.helm.sh/release-namespace"] === target.namespace);
              const foreignOwner = sa.metadata?.ownerReferences?.some((ref) =>
                ref.kind !== "Namespace" || ref.apiVersion !== "v1" || ref.name !== owner.name || ref.uid !== owner.uid);
              const foreignRelease = account.release && (
                (annotations["meta.helm.sh/release-name"] && annotations["meta.helm.sh/release-name"] !== account.release)
                || (annotations["meta.helm.sh/release-namespace"] && annotations["meta.helm.sh/release-namespace"] !== target.namespace)
                || (labels["app.kubernetes.io/instance"] && labels["app.kubernetes.io/instance"] !== account.release)
              );
              // A Namespace owner does not override a conflicting release. Regular
              // SAs also need the exact metadata Helm requires for adoption.
              if (foreignOwner || foreignRelease
                || (annotations["tali.io/project-id"] && annotations["tali.io/project-id"] !== target.projectId)
                || (account.release && !account.hook ? !legacy : !owned && !legacy)) {
                throw new ImagePullPreparationError(`Refusing to adopt foreign ServiceAccount ${account.name}.`);
              }
            }
            const internal = hosts[index]!;
            const names = [...new Set([...account.secrets.map((s) => s.name),
              ...(internal.length ? (sa.imagePullSecrets ?? []).flatMap((s) => s.name ? [s.name] : []) : [])])];
            let complete = true;
            const keys: string[] = [];
            for (const name of names) {
              let secret: V1Secret;
              try {
                secret = await this.core.readNamespacedSecret({ namespace: target.namespace, name }, options());
              } catch (error) {
                if (status(error) !== 404) throw error;
                complete = false; pending = `pull Secret ${name} is missing`; break;
              }
              const authKeys = registryKeys(secret);
              if (!authKeys.length) { complete = false; pending = `pull Secret ${name} has no valid registry configuration`; break; }
              keys.push(...authKeys);
            }
            if (complete) {
              const missing = account.images.filter((image) => internal.includes(image.split("/")[0]!)
                && !keys.some((key) => keyMatchesImage(key, image)));
              if (!missing.length) { results.push(names.map((name) => ({ name }))); break; }
              pending = `no pull credential for internal registry ${missing.join(", ")}`;
            }
          }
        } catch (error) {
          // Do not serialize Kubernetes request/response bodies, which can contain Secret data.
          const code = status(error);
          if (!(code === 429 || code >= 500 || ["AbortError", "TimeoutError"].includes((error as Error)?.name))) {
            const detail = error instanceof ImagePullPreparationError ? error.message
              : "check Worker API permissions and resource availability";
            throw new Error(`OpenShift image pull preparation failed: namespace=${target.namespace}, SA=${account.name}${code ? ` (HTTP ${code})` : ""}: ${detail}`);
          }
          pending = `Kubernetes API temporarily unavailable${code ? ` (HTTP ${code})` : ""}`;
        }
        await this.sleep(Math.min(1000, Math.max(0, deadline - this.now())));
      }
    }
    return results;
  }
}

function client() {
  const kube = new KubeConfig(); kube.loadFromCluster();
  return new ProjectImagePullReadiness(kube.makeApiClient(CoreV1Api), getWorkerConfig().openshift);
}

export async function prepareRuntimeImagePull(target: Target, image: string, secrets: PullSecret[]): Promise<PullSecret[]> {
  if (!getWorkerConfig().openshift.enabled) return secrets;
  return (await client().prepare(target, [{ name: "default", managed: false, images: [image], secrets }]))[0]!;
}

export async function prepareGatewayImagePull(target: Target, config: {
  releaseName: string; serviceNamePrefix: string;
  gatewayImageRepository: string; gatewayImageTag: string; imagePullSecrets: PullSecret[];
  supervisorImageRepository: string; supervisorImageTag: string; sandboxImage: string; sandboxImages?: string[] | undefined; sandboxImagePullSecrets: PullSecret[];
}) {
  if (!getWorkerConfig().openshift.enabled) return undefined;
  const names = projectPullServiceAccounts(`${config.serviceNamePrefix}${target.namespace}`);
  const gateway = `${config.gatewayImageRepository}:${config.gatewayImageTag}`;
  const [gatewaySecrets, certgenSecrets, sandboxSecrets] = await client().prepare(target, [
    { name: names.gateway, managed: true, release: config.releaseName, images: [gateway], secrets: config.imagePullSecrets },
    { name: names.certgen, managed: true, release: config.releaseName, hook: true, images: [gateway], secrets: config.imagePullSecrets },
    { name: names.sandbox, managed: true, release: config.releaseName,
      images: [config.sandboxImage, ...(config.sandboxImages ?? []), `${config.supervisorImageRepository}:${config.supervisorImageTag}`], secrets: config.sandboxImagePullSecrets },
  ]);
  return { gatewaySecrets: gatewaySecrets!, certgenSecrets: certgenSecrets!, sandboxSecrets: sandboxSecrets! };
}

/** Check the entire platform image set before any Helm hook can run. */
export function validateWorkerImageSources(config = getWorkerConfig()): void {
  const images: string[] = [];
  for (const runtime of [config.project_runtime_bridge, config.expert_agent_runtime]) {
    if (runtime.enabled) images.push(runtime.image);
  }
  const gateway = config.project_openshell;
  if (gateway.enabled) images.push(`${gateway.gatewayImageRepository}:${gateway.gatewayImageTag}`,
    `${gateway.supervisorImageRepository}:${gateway.supervisorImageTag}`, gateway.sandboxImage,
    ...(gateway.sandboxImages ?? []));
  validateProjectImageSources(images, config.openshift);
}
