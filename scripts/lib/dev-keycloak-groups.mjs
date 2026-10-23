import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Renaming a group preserves its ID, children and existing user memberships.
export async function alignProjectGroups(request, department, projects) {
  const path = name => `/tali/d/${department}/p/${name}`;
  const lookup = name => `/admin/realms/tali/group-by-path${path(name).split("/").map(encodeURIComponent).join("/")}`;
  for (const project of projects) {
    if (project.groupName === project.id) continue;
    const target = await request("GET", lookup(project.id));
    if (target.status === 200) continue;
    if (target.status !== 404) throw new Error(`Cannot check Keycloak Project group: HTTP ${target.status}.`);
    const source = await request("GET", lookup(project.groupName));
    if (source.status !== 200 || source.body.path !== path(project.groupName) || !source.body.id) {
      throw new Error(`Missing configured Keycloak Project group ${project.groupName}.`);
    }
    const renamed = await request("PUT", `/admin/realms/tali/groups/${encodeURIComponent(source.body.id)}`, {name:project.id});
    if (renamed.status !== 204) throw new Error(`Cannot align Keycloak Project group: HTTP ${renamed.status}.`);
  }
}

async function main() {
  const context = process.env.KUBE_CONTEXT;
  const namespace = process.env.HELM_NAMESPACE;
  const name = process.env.KEYCLOAK_CREDENTIAL_SECRET;
  if (!context || !namespace || !name) throw new Error("Keycloak credential Secret location is required.");
  const secret = JSON.parse(execFileSync("kubectl", ["--context", context, "-n", namespace, "get", "secret", name, "-o", "json"], {encoding:"utf8"}));
  const credential = Buffer.from(secret.data?.["keycloak-admin-password"] ?? "", "base64").toString();
  if (!credential) throw new Error("Keycloak administrator credential is missing.");
  const origin = new URL(process.env.KEYCLOAK_PUBLIC_URL).origin;
  const response = await fetch(`${origin}/realms/master/protocol/openid-connect/token`, {
    method:"POST", signal:AbortSignal.timeout(30000),
    body:new URLSearchParams({grant_type:"password", client_id:"admin-cli", username:process.env.KEYCLOAK_ADMIN_USERNAME ?? "admin", password:credential}),
  });
  if (!response.ok) throw new Error(`Cannot authenticate Keycloak administrator: HTTP ${response.status}.`);
  const token = (await response.json()).access_token;
  if (!token) throw new Error("Keycloak administrator token is missing.");
  const request = async (method, path, body) => {
    const result = await fetch(`${origin}${path}`, {method, signal:AbortSignal.timeout(30000),
      headers:{authorization:`Bearer ${token}`, "content-type":"application/json"}, body:body ? JSON.stringify(body) : undefined});
    return {status:result.status, body:result.status === 200 ? await result.json() : {}};
  };
  await alignProjectGroups(request, process.env.KEYCLOAK_DEPARTMENT_ID, JSON.parse(readFileSync(0, "utf8")));
  console.log("Aligned Keycloak test groups with current Project IDs.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
