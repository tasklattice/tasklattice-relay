import { test } from "node:test";
import assert from "node:assert/strict";
import { alignProjectGroups } from "../lib/dev-keycloak-groups.mjs";

test("dynamic Project group names converge without replacing group identities", async () => {
  const group = {id:"stable-group-id", name:"isolation-1", path:"/tali/d/dep1/p/isolation-1"};
  let writes = 0;
  const request = async (method, path, body) => {
    if (method === "GET") return path.endsWith(group.path) ? {status:200, body:{...group}} : {status:404, body:{}};
    assert.equal(path, "/admin/realms/tali/groups/stable-group-id");
    group.name = body.name; group.path = `/tali/d/dep1/p/${body.name}`; writes++;
    return {status:204};
  };
  const projects = [{id:"tp-generated", groupName:"isolation-1"}];
  await alignProjectGroups(request, "dep1", projects);
  await alignProjectGroups(request, "dep1", projects);
  assert.equal(writes, 1);
  assert.equal(group.name, "tp-generated");
});

test("inaccessible or missing source groups fail without writes", async () => {
  let writes = 0;
  await assert.rejects(alignProjectGroups(async method => {
    if (method !== "GET") writes++;
    return {status:404, body:{}};
  }, "dep1", [{id:"tp-generated", groupName:"isolation-1"}]), /Missing configured/);
  assert.equal(writes, 0);
});
