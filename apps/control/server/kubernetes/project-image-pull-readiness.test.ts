import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectImagePullReadiness, prepareGatewayImagePull, prepareRuntimeImagePull, validateProjectImageSources } from "./project-image-pull-readiness";
import { KubeConfig, type V1ServiceAccount } from "@kubernetes/client-node";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";

afterEach(() => { setWorkerConfigForTests(); vi.restoreAllMocks(); });

const host = "image-registry.openshift-image-registry.svc:5000";
const target = { namespace: "tp-abcdefghijklm", projectId: "project-a" };
const owner = { apiVersion: "v1", kind: "Namespace", name: target.namespace, uid: "ns-uid" };
const config = { enabled: true, imageSourceNamespace: "shared", imagePullReadyTimeoutMs: 3000 };
const account = { name: "tali-pull-certgen", managed: true, images: [`${host}/shared/gateway:v1`], secrets: [] as {name: string}[] };
function secret(registry = host) {
  return { type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": Buffer.from(JSON.stringify({ auths: { [registry]: { auth: "DO-NOT-LOG" } } })).toString("base64") } };
}
function setup() {
  let now = 0;
  let sa: V1ServiceAccount | undefined;
  const core = {
    readNamespace: vi.fn(async () => ({ metadata: { name: target.namespace, uid: owner.uid, annotations: { "tali.io/project-id": target.projectId } } })),
    readNamespacedServiceAccount: vi.fn(async () => { if (!sa) throw { code: 404 }; return sa; }),
    createNamespacedServiceAccount: vi.fn(async ({ body }) => { sa = body; return body; }),
    readNamespacedSecret: vi.fn(async (_input: { name: string }) => secret()),
  };
  const ready = () => { if (sa) sa.imagePullSecrets = [{ name: "ocp-pull" }]; };
  const sleep = vi.fn(async (ms: number) => { now += ms; ready(); });
  const client = new ProjectImagePullReadiness(core as never, config, () => now, sleep);
  return { client, core, sleep, setSA: (value: V1ServiceAccount) => { sa = value; } };
}
describe("Project image pull preparation", () => {
  it("waits for credentials on a dynamically created owned SA, then is idempotent", async () => {
    const s = setup();
    await expect(s.client.prepare(target, [account])).resolves.toEqual([[{ name: "ocp-pull" }]]);
    expect(s.core.createNamespacedServiceAccount).toHaveBeenCalledWith(expect.objectContaining({
      namespace: target.namespace, body: expect.objectContaining({ metadata: expect.objectContaining({ ownerReferences: [expect.objectContaining(owner)] }) }),
    }), expect.anything());
    await s.client.prepare(target, [account]);
    expect(s.core.createNamespacedServiceAccount).toHaveBeenCalledTimes(1);
  });
  it("preserves explicit external secrets and merges the actual SA's internal pull secret", async () => {
    const s = setup();
    s.core.readNamespacedSecret.mockImplementation(async ({ name }: {name: string}) => secret(name === "external" ? "registry.example" : host));
    await expect(s.client.prepare(target, [{ ...account, secrets: [{name:"external"}, {name:"external"}] }]))
      .resolves.toEqual([[{ name: "external" }, { name: "ocp-pull" }]]);
  });
  it("does not require internal credentials for public external images", async () => {
    const s = setup();
    await expect(s.client.prepare(target, [{ ...account, images: ["quay.io/team/gateway:v1"] }])).resolves.toEqual([[]]);
    expect(s.core.readNamespacedSecret).not.toHaveBeenCalled();
  });
  it("never creates or adopts the platform default SA", async () => {
    const s = setup();
    s.sleep.mockImplementation(async () => { s.setSA({ metadata: {name:"default"}, imagePullSecrets:[{name:"ocp-pull"}] }); });
    await expect(s.client.prepare(target, [{ ...account, name: "default", managed: false }])).resolves.toEqual([[{name:"ocp-pull"}]]);
    expect(s.core.createNamespacedServiceAccount).not.toHaveBeenCalled();
  });
  it("rejects foreign SAs and terminating namespaces", async () => {
    const s = setup(); s.setSA({metadata:{name:account.name}});
    await expect(s.client.prepare(target,[account])).rejects.toThrow("foreign ServiceAccount");
    s.core.readNamespace.mockResolvedValue({metadata:{name:target.namespace,uid:owner.uid,annotations:{"tali.io/project-id":"other"}}});
    await expect(s.client.prepare(target,[account])).rejects.toThrow("ownership");
  });
  it("reports missing explicit secrets without exposing their contents", async () => {
    const s = setup(); s.core.readNamespacedSecret.mockRejectedValue({code:404});
    await expect(s.client.prepare(target,[{...account,secrets:[{name:"missing"}]}])).rejects.toThrow(/SA=tali-pull-certgen: pull Secret missing is missing/);
  });
  it("does not accept a secret for the wrong internal registry", async () => {
    const s = setup(); s.core.readNamespacedSecret.mockResolvedValue(secret("other.example"));
    await expect(s.client.prepare(target,[account])).rejects.toThrow("no pull credential for internal registry");
  });
  it("stops on permission errors and never exposes API response bodies", async () => {
    const s=setup(); s.core.readNamespacedServiceAccount.mockRejectedValue({code:403,body:{data:"DO-NOT-LOG"}});
    await expect(s.client.prepare(target,[account])).rejects.toThrow("HTTP 403");
    expect(s.sleep).not.toHaveBeenCalled();
  });
  it("redacts SDK error messages without HTTP status while retaining tenant and SA context", async () => {
    const s = setup();
    s.setSA({metadata:{name:account.name,ownerReferences:[owner]},imagePullSecrets:[{name:"ocp-pull"}]});
    s.core.readNamespacedSecret.mockRejectedValue(new Error("invalid response: DO-NOT-LOG"));
    const error = await s.client.prepare(target,[account]).then(
      () => { throw new Error("expected preparation to fail"); }, error => error as Error,
    );
    expect(error.message).toContain(`namespace=${target.namespace}, SA=${account.name}`);
    expect(error.message).not.toContain("DO-NOT-LOG");
  });
  it("checks the lease before creating resources", async () => {
    const s=setup();
    await expect(s.client.prepare({...target,assertCurrent:async()=>{throw new Error("cancelled");}},[account])).rejects.toThrow("cancelled");
    expect(s.core.readNamespace).not.toHaveBeenCalled();
  });
  it("aborts when a namespace is recreated during preparation", async () => {
    const s=setup();
    s.core.readNamespace.mockResolvedValueOnce({metadata:{name:target.namespace,uid:"old",annotations:{"tali.io/project-id":target.projectId}}});
    await expect(s.client.prepare(target,[account])).rejects.toThrow("recreated");
  });
  it("is a no-op on ordinary Kubernetes", async () => {
    const s=setup(); const client=new ProjectImagePullReadiness(s.core as never,{enabled:false});
    await expect(client.prepare(target,[account])).resolves.toEqual([[]]);
    expect(s.core.readNamespace).not.toHaveBeenCalled();
  });
  it("does not load in-cluster credentials or alter explicit pull secrets on ordinary Kubernetes", async () => {
    const worker = developmentWorkerConfig();
    setWorkerConfigForTests({...worker,openshift:{enabled:false}});
    const load = vi.spyOn(KubeConfig.prototype, "loadFromCluster").mockImplementation(() => { throw new Error("unexpected cluster access"); });
    const secrets = [{name:"external-registry"}];
    await expect(prepareRuntimeImagePull(target, `${host}/other-source/runtime:v1`, secrets)).resolves.toBe(secrets);
    await expect(prepareGatewayImagePull(target, worker.project_openshell)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects source mismatches before any Kubernetes calls, including a custom registry route", async () => {
    const s=setup();
    await expect(s.client.prepare(target,[{...account,images:[`${host}/wrong/gateway:v1`]}])).rejects.toThrow("source mismatch");
    expect(s.core.readNamespace).not.toHaveBeenCalled();
    expect(()=>validateProjectImageSources(["registry.apps.example/wrong/image:v1"],{...config,imageRegistryHost:"registry.apps.example"})).toThrow("source mismatch");
    expect(validateProjectImageSources(["docker.io/library/alpine:3"],config)).toEqual([]);
  });
});

describe("existing OpenShell SA compatibility", () => {
  it("accepts the existing release-owned SA without recreating or rewriting it", async () => {
    const s=setup();
    s.setSA({metadata:{name:account.name,labels:{"app.kubernetes.io/managed-by":"Helm"},annotations:{
      "meta.helm.sh/release-name":"openshell","meta.helm.sh/release-namespace":target.namespace,
    }},imagePullSecrets:[{name:"ocp-pull"}]});
    await expect(s.client.prepare(target,[{...account,release:"openshell"}])).resolves.toEqual([[{name:"ocp-pull"}]]);
    expect(s.core.createNamespacedServiceAccount).not.toHaveBeenCalled();
    await expect(s.client.prepare(target,[{...account,release:"different"}])).rejects.toThrow("foreign ServiceAccount");
  });
  it("recognizes a certgen hook left by an interrupted install", async () => {
    const s=setup();
    s.setSA({metadata:{name:account.name,labels:{"app.kubernetes.io/instance":"openshell","app.kubernetes.io/name":"openshell"},
      annotations:{"helm.sh/hook":"pre-install,pre-upgrade"}},imagePullSecrets:[{name:"ocp-pull"}]});
    await expect(s.client.prepare(target,[{...account,release:"openshell",hook:true}])).resolves.toEqual([[{name:"ocp-pull"}]]);
    expect(s.core.createNamespacedServiceAccount).not.toHaveBeenCalled();
  });
  it("precreates regular SAs with Helm ownership so install can adopt them", async () => {
    const s=setup(); await s.client.prepare(target,[{...account,release:"openshell"}]);
    expect(s.core.createNamespacedServiceAccount).toHaveBeenCalledWith(expect.objectContaining({body:expect.objectContaining({metadata:expect.objectContaining({
      labels:{"app.kubernetes.io/managed-by":"Helm"},annotations:expect.objectContaining({"meta.helm.sh/release-name":"openshell","meta.helm.sh/release-namespace":target.namespace}),
    })})}),expect.anything());
  });
  it.each([false, true])("rejects conflicting release ownership even with the right Namespace owner (hook=%s)", async (hook) => {
    const s = setup();
    s.setSA({metadata:{name:account.name,ownerReferences:[owner],
      labels:{"app.kubernetes.io/managed-by":"Helm","app.kubernetes.io/instance":"other-release"},
      annotations:{"meta.helm.sh/release-name":"other-release","meta.helm.sh/release-namespace":target.namespace},
    },imagePullSecrets:[{name:"ocp-pull"}]});
    await expect(s.client.prepare(target,[{...account,release:"openshell",hook}])).rejects.toThrow("foreign ServiceAccount");
    expect(s.core.readNamespacedSecret).not.toHaveBeenCalled();
    expect(s.core.createNamespacedServiceAccount).not.toHaveBeenCalled();
  });
  it("rejects a regular SA without Helm adoption metadata even when it has a Namespace owner", async () => {
    const s = setup(); s.setSA({metadata:{name:account.name,ownerReferences:[owner]}});
    await expect(s.client.prepare(target,[{...account,release:"openshell"}])).rejects.toThrow("foreign ServiceAccount");
  });
  it("records release identity on a new persistent certgen SA", async () => {
    const s = setup(); await s.client.prepare(target,[{...account,release:"openshell",hook:true}]);
    expect(s.core.createNamespacedServiceAccount).toHaveBeenCalledWith(expect.objectContaining({body:expect.objectContaining({metadata:expect.objectContaining({
      labels:{"app.kubernetes.io/managed-by":"tali"},annotations:expect.objectContaining({"meta.helm.sh/release-name":"openshell","meta.helm.sh/release-namespace":target.namespace}),
    })})}),expect.anything());
    await s.client.prepare(target,[{...account,release:"openshell",hook:true}]);
    expect(s.core.createNamespacedServiceAccount).toHaveBeenCalledTimes(1);
  });
  it("supports repository-scoped and wildcard registry credentials", async () => {
    const s=setup(); s.core.readNamespacedSecret.mockResolvedValue(secret("https://*.openshift-image-registry.svc:5000/shared/gateway"));
    await expect(s.client.prepare(target,[account])).resolves.toEqual([[{name:"ocp-pull"}]]);
  });
  it("retries API throttling within the same deadline", async () => {
    const s=setup(); s.core.readNamespace.mockRejectedValueOnce({code:429});
    await expect(s.client.prepare(target,[account])).resolves.toEqual([[{name:"ocp-pull"}]]);
  });
});
