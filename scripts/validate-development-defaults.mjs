#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

const developmentProjects = JSON.parse(
  readFileSync("config/development-projects.json", "utf8"),
);
const expectedProjects = [
  { departmentId: "dep1", id: "isolation-1", name: "Isolation 1" },
  { departmentId: "dep1", id: "isolation-2", name: "Isolation 2" },
];
if (JSON.stringify(developmentProjects) !== JSON.stringify(expectedProjects)) {
  throw new Error(
    "Development defaults must declare isolation-1 and isolation-2 in dep1.",
  );
}

const rendered = execFileSync(
  "helm",
  [
    "template",
    "tali-relay",
    "charts/tali-relay",
    "--namespace",
    "tali-development-defaults",
    "--kube-version",
    "1.29.0",
    "--values",
    "charts/tali-relay/values-dev.yaml",
    "--set-string",
    "control.publicUrl=http://localhost:38080",
    "--set",
    "keycloak.enabled=true",
    "--set-string",
    "keycloak.publicUrl=http://keycloak.localhost:8180",
  ],
  { encoding: "utf8" },
);
const objects = parseAllDocuments(rendered, { uniqueKeys: false })
  .map((document) => {
    if (document.errors.length) throw document.errors[0];
    return document.toJS();
  })
  .filter((object) => object && typeof object === "object");
const secret = objects.find(
  (object) => object.kind === "Secret"
    && object.metadata?.name === "tali-relay-secrets",
);
if (!secret) throw new Error("The development Secret was not rendered.");
for (const key of [
  "keycloak-admin-password",
  "keycloak-test-user-password",
  "litellm-ui-password",
]) {
  if (secret.stringData?.[key] !== "password") {
    throw new Error(`${key} must use the development password default.`);
  }
}
if (!secret.stringData?.["control.toml"]?.includes(
  'initial_platform_administrator_password = "password"',
)) {
  throw new Error(
    "The local Platform Administrator must use the development password default.",
  );
}

const realmConfig = objects.find(
  (object) => object.kind === "ConfigMap"
    && object.metadata?.name === "tali-relay-keycloak-realm",
);
if (!realmConfig) throw new Error("The development Keycloak realm was not rendered.");
const realm = JSON.parse(realmConfig.data["tali-realm.json"]);
if (!realm.users?.length) throw new Error("The Keycloak realm has no test users.");
for (const user of realm.users) {
  const passwords = (user.credentials ?? [])
    .filter(({ type }) => type === "password")
    .map(({ value }) => value);
  if (
    passwords.length !== 1
    || passwords[0] !== "${TALI_KEYCLOAK_TEST_USER_PASSWORD}"
  ) {
    throw new Error(
      `Keycloak test user ${user.username} does not use the shared development password Secret.`,
    );
  }
}
const taliGroup = realm.groups?.find(({ name }) => name === "tali");
const departmentProjects = taliGroup?.subGroups
  ?.find(({ name }) => name === "d")?.subGroups
  ?.find(({ name }) => name === "dep1")?.subGroups
  ?.find(({ name }) => name === "p")?.subGroups
  ?.map(({ name }) => name) ?? [];
for (const { id } of expectedProjects) {
  if (!departmentProjects.includes(id)) {
    throw new Error(`The Keycloak realm is missing Project group ${id}.`);
  }
}

console.log(
  `Validated ${developmentProjects.length} development isolation Projects and ${realm.users.length + 3} password defaults.`,
);
