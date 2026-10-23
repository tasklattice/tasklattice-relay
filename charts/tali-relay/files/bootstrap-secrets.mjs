import { createHash, randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import https from "node:https";
import { pathToFileURL } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

class BootstrapError extends Error {}

export const credentialKeys = [
  "postgresPassword", "authSecret", "initialPlatformAdministratorPassword",
  "runnerToken", "litellmMasterKey", "litellmUiPassword", "litellmSaltKey",
  "keycloakAdminPassword", "keycloakClientSecret", "keycloakTestUserPassword",
  "hindsightDatabasePassword", "hindsightApiKey", "hindsightRouterToken",
  "metricsToken", "exampleMcpPassword",
];
const urlKeys = ["databaseUrl", "adminUrl", "hindsightDatabaseUrl"];
const retention = { "helm.sh/resource-policy": "keep", "argocd.argoproj.io/compare-options": "IgnoreExtraneous",
  "argocd.argoproj.io/sync-options": "Prune=false,Delete=false" };
const fingerprintKey = "tali.io/credential-fingerprint";
const fingerprint = credentials => createHash("sha256")
  .update(JSON.stringify([...credentialKeys, ...urlKeys].map(key => [key, credentials[key]]))).digest("hex");
const dbUrl = (host, user, credential, database) =>
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(credential)}@${host}:5432/${encodeURIComponent(database)}`;

export function generateCredentials(spec) {
  const data = Object.fromEntries(credentialKeys.map(key => [key, randomBytes(32).toString("hex")]));
  data.litellmMasterKey = `sk-${data.litellmMasterKey}`;
  data.databaseUrl = dbUrl(spec.databaseHost, "litellm", data.postgresPassword, "litellm");
  data.adminUrl = dbUrl(spec.databaseHost, "litellm", data.postgresPassword, "postgres");
  data.hindsightDatabaseUrl = dbUrl(spec.databaseHost, spec.hindsightUser, data.hindsightDatabasePassword, spec.hindsightDatabase);
  return data;
}

export function validateCredentials(data, spec) {
  if ([...credentialKeys, ...urlKeys].some(key => typeof data[key] !== "string" || !data[key])) {
    throw new BootstrapError("Credential Secret is incomplete; refusing to regenerate credentials.");
  }
  for (const [key, credential] of [["databaseUrl", "postgresPassword"], ["adminUrl", "postgresPassword"], ["hindsightDatabaseUrl", "hindsightDatabasePassword"]]) {
    let valid = false;
    try {
      const url = new URL(data[key]);
      valid = ["postgres:", "postgresql:"].includes(url.protocol) && decodeURIComponent(url.password) === data[credential];
    } catch { /* Never include the connection string in errors. */ }
    if (!valid) throw new BootstrapError(`Credential Secret contains inconsistent ${key}; refusing to replace credentials.`);
  }
  if (!spec.externalCredentials) {
    for (const key of urlKeys) {
      const expected = key === "hindsightDatabaseUrl"
        ? dbUrl(spec.databaseHost, spec.hindsightUser, data.hindsightDatabasePassword, spec.hindsightDatabase)
        : dbUrl(spec.databaseHost, "litellm", data.postgresPassword, key === "adminUrl" ? "postgres" : "litellm");
      if (data[key] !== expected) throw new BootstrapError(`Database configuration changed for ${key}; explicit credential migration is required.`);
    }
  }
}

const marker = /__TALI_CREDENTIAL_([A-Za-z]+)__/g;
function substitute(value, credentials) {
  if (Array.isArray(value)) return value.map(item => substitute(item, credentials));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, credentials)]));
  if (typeof value !== "string") return value;
  return value.replace(marker, (_match, key) => {
    if (!Object.hasOwn(credentials, key)) throw new BootstrapError(`Unknown credential reference ${key}.`);
    return credentials[key];
  });
}

export function renderOutput(output, credentials) {
  return Object.fromEntries(Object.entries(output.fields).map(([key, template]) => {
    const format = output.formats?.[key];
    const value = format === "toml" ? stringifyToml(substitute(parseToml(template), credentials))
      : format === "json" ? JSON.stringify(substitute(JSON.parse(template), credentials), null, 2)
      : substitute(template, credentials);
    return [key, value];
  }));
}

const decode = secret => Object.fromEntries(Object.entries(secret.data ?? {}).map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")]));
function requireOwner(secret, spec, owner) {
  const m = secret.metadata ?? {};
  const refs = m.ownerReferences ?? [];
  if (m.deletionTimestamp || m.labels?.["app.kubernetes.io/managed-by"] !== "tali-relay-bootstrap"
    || m.labels?.["tali.io/release"] !== spec.release || m.namespace !== spec.namespace
    || refs.length !== 1 || refs[0].kind !== "Namespace" || refs[0].apiVersion !== "v1"
    || refs[0].uid !== owner.uid || refs[0].name !== owner.name) {
    throw new BootstrapError(`Secret ${m.name ?? "unknown"} has a foreign or terminating owner; refusing to overwrite it.`);
  }
}

function resource(name, data, spec, owner, annotations = {}) {
  return { apiVersion: "v1", kind: "Secret", type: "Opaque", metadata: {
    name, namespace: spec.namespace, ownerReferences: [owner],
    labels: { "app.kubernetes.io/managed-by": "tali-relay-bootstrap", "tali.io/release": spec.release,
      "app.kubernetes.io/instance": spec.release, "app.kubernetes.io/part-of": "tasklattice-relay" },
    annotations: { ...retention, ...annotations },
  }, stringData: data };
}

export async function bootstrap(request, spec) {
  const names = [spec.credentialSecret, ...spec.outputs.map(output => output.name)];
  if (new Set(names).size !== names.length) throw new BootstrapError("Credential store and output Secret names must be distinct.");
  const base = `/api/v1/namespaces/${encodeURIComponent(spec.namespace)}`;
  const ns = await request("GET", base);
  if (ns.status !== 200 || ns.body.metadata?.name !== spec.namespace || !ns.body.metadata?.uid || ns.body.metadata.deletionTimestamp) {
    throw new BootstrapError("Cannot verify the installation Namespace.");
  }
  const owner = { apiVersion: "v1", kind: "Namespace", name: spec.namespace,
    uid: ns.body.metadata.uid, controller: false, blockOwnerDeletion: false };
  const secretPath = name => `${base}/secrets/${encodeURIComponent(name)}`;
  let root = await request("GET", secretPath(spec.credentialSecret));
  if (root.status === 404 && !spec.externalCredentials) {
    // A lost credential store or legacy installation is not a fresh install.
    // Never invent replacement database/encryption credentials for existing outputs.
    for (const output of spec.outputs) {
      const existing = await request("GET", secretPath(output.name));
      if (existing.status !== 404) {
        // Another initializer may have committed the store and outputs after
        // our first read. Use that store rather than treating this as data loss.
        root = await request("GET", secretPath(spec.credentialSecret));
        if (root.status !== 200) throw new BootstrapError(`Credential store is missing but output ${output.name} exists or cannot be checked; refusing to initialize.`);
        break;
      }
    }
    if (root.status === 404) {
      const data = generateCredentials(spec);
      root = await request("POST", `${base}/secrets`, { ...resource(spec.credentialSecret, data, spec, owner), immutable: true });
      if (root.status === 409) root = await request("GET", secretPath(spec.credentialSecret));
    }
  }
  if (![200, 201].includes(root.status)) throw new BootstrapError(`Cannot read/create credential Secret: HTTP ${root.status}.`);
  if (root.body.metadata?.deletionTimestamp) throw new BootstrapError("Credential Secret is terminating; restore it before retrying initialization.");
  if (!spec.externalCredentials) requireOwner(root.body, spec, owner);
  const credentials = decode(root.body);
  validateCredentials(credentials, spec);
  const annotations = { ...retention, [fingerprintKey]: fingerprint(credentials) };
  const requireOutput = secret => {
    requireOwner(secret, spec, owner);
    if (secret.metadata.annotations?.[fingerprintKey] !== annotations[fingerprintKey]) {
      throw new BootstrapError(`Credential source changed for ${secret.metadata.name}; refusing to rotate existing component credentials.`);
    }
  };

  // Validate every existing output and render every document before changing any
  // configuration. A late foreign Secret or malformed template must not leave
  // earlier consumers updated with a different credential source.
  const outputs = spec.outputs.map(output => ({ name: output.name, data: renderOutput(output, credentials) }));
  for (const output of outputs) {
    const existing = await request("GET", secretPath(output.name));
    if (existing.status === 200) requireOutput(existing.body);
    else if (existing.status !== 404) throw new BootstrapError(`Cannot read configuration Secret ${output.name}: HTTP ${existing.status}.`);
  }

  for (const { name, data } of outputs) {
    let done = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await request("GET", secretPath(name));
      if (existing.status === 404) {
        const created = await request("POST", `${base}/secrets`, resource(name, data, spec, owner, annotations));
        if (created.status === 409) continue;
        if (created.status !== 201) throw new BootstrapError(`Cannot create configuration Secret ${name}: HTTP ${created.status}.`);
        done = true; break;
      }
      if (existing.status !== 200) throw new BootstrapError(`Cannot read configuration Secret ${name}: HTTP ${existing.status}.`);
      requireOutput(existing.body);
      const current = decode(existing.body);
      if (Object.entries(data).every(([key, value]) => current[key] === value)
        && Object.entries(annotations).every(([key, value]) => existing.body.metadata.annotations?.[key] === value)) { done = true; break; }
      // Config settings can change on upgrade; credential source remains immutable.
      const updated = await request("PATCH", secretPath(name), {
        metadata: { resourceVersion: existing.body.metadata.resourceVersion, annotations }, stringData: data,
      });
      if (updated.status === 409) continue;
      if (updated.status !== 200) throw new BootstrapError(`Cannot update configuration Secret ${name}: HTTP ${updated.status}.`);
      done = true; break;
    }
    if (!done) throw new BootstrapError(`Concurrent updates prevented initializing ${name}; retry the Job.`);
  }
}

export function apiRequest() {
  const directory = "/var/run/secrets/kubernetes.io/serviceaccount";
  const ca = readFileSync(`${directory}/ca.crt`);
  const token = readFileSync(`${directory}/token`, "utf8").trim();
  return (method, path, body) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: process.env.KUBERNETES_SERVICE_HOST,
      port: Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS || 443), method, path, ca, timeout: 15000,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": method === "PATCH" ? "application/merge-patch+json" : "application/json" },
    }, res => {
      let content = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { content += chunk; });
      res.on("error", () => reject(new Error("Kubernetes API response failed.")));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: content ? JSON.parse(content) : {} }); }
        catch { reject(new Error("Invalid Kubernetes API response.")); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => reject(new Error("Kubernetes API request failed.")));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

// ConfigMap volumes expose files through ..data symlinks. Node resolves the
// module URL, but leaves argv[1] as the symlink used to launch the process.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
  bootstrap(apiRequest(), spec).then(() => console.log("Credential initialization complete; existing credentials retained."))
    .catch(error => { console.error(error instanceof BootstrapError ? error.message : "Credential initialization failed; inspect bootstrap RBAC and configuration."); process.exitCode = 1; });
}
