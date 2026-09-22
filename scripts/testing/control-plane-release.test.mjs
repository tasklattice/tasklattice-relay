import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { parseControlReleaseTag, pinControlReleaseValues, releaseImages, affectedImages, makePlan, selectPreviousRelease } from "../control-plane-release.mjs";
const registry = "ghcr.io/tasklattice";
const sha = "a".repeat(40);
function previous() {
  const plan = makePlan("v0.2.8-rc.1", registry, sha, [], undefined);
  plan.images.forEach(i => { i.digest = `sha256:${"b".repeat(64)}`; });
  return plan;
}
test("RC tag identifies release series, not a stable image dependency", () => {
  assert.deepEqual(parseControlReleaseTag("v0.2.8-rc.2"), { version: "0.2.8-rc.2", series: "0.2.8", rc: "2" });
  for (const tag of ["v0.2.8", "v0.2.8-rc.0", "v0.2.8-rc.01", "v00.2.8-rc.1", "v0.2.8-rc.1-extra", "v0.2.8 RC1", "v0.2.8-rc.1\n"]) assert.throws(() => parseControlReleaseTag(tag));
});
test("every first-party chart image uses the current RC, including reused images", () => {
  const original = parse(readFileSync("charts/tali-relay/values.yaml", "utf8"));
  const values = pinControlReleaseValues(structuredClone(original), "v0.2.8-rc.2", registry);
  for (const key of Object.keys(releaseImages)) assert.equal(values.images[key].tag, "0.2.8-rc.2");
  assert.equal(Object.keys(releaseImages).length, 8);
  assert.deepEqual(values.openshell, original.openshell);
  original.images.newApplication = { repository: "new-app", tag: "" };
  assert.throws(() => pinControlReleaseValues(original, "v0.2.8-rc.1", registry), /Unpinned/);
});
test("selects the highest published prior RC in the same series, not draft or stable releases", () => {
  const releases = ["v0.2.8-rc.2", "v0.2.8-rc.10", "v0.2.9-rc.1", "v0.2.8", "v0.2.8-rc.99"].map(tag_name => ({
    tag_name, prerelease: tag_name.includes("-rc."), draft: tag_name.endsWith("99"),
  }));
  assert.equal(selectPreviousRelease("v0.2.8-rc.11", releases).tag_name, "v0.2.8-rc.10");
  assert.equal(selectPreviousRelease("v0.2.8-rc.1", releases), undefined);
  assert.equal(selectPreviousRelease("v0.3.0-rc.2", releases), undefined);
});
test("first RC or absent compatible predecessor builds all eight images", () => {
  for (const tag of ["v0.2.8-rc.1", "v0.2.8-rc.3"]) {
    const plan = makePlan(tag, registry, sha, [], undefined);
    assert.equal(plan.images.length, 8);
    assert(plan.images.every(i => i.action === "build" && !i.source));
  }
});
test("Control-only fix rebuilds Control and reuses seven exact digests", () => {
  const plan = makePlan("v0.2.8-rc.2", registry, sha, ["apps/control/server/foo.ts"], previous());
  assert.deepEqual(plan.images.filter(i => i.action === "build").map(i => i.key), ["control"]);
  const reused = plan.images.filter(i => i.action === "reuse");
  assert.equal(reused.length, 7);
  assert(reused.every(i => i.reference.endsWith(":0.2.8-rc.2") && i.source.endsWith(`@sha256:${"b".repeat(64)}`) && i.sourceTag === "v0.2.8-rc.1"));
});
test("transitive dependencies and unknown files invalidate conservatively", () => {
  assert.deepEqual([...affectedImages(["apps/expert-agent-runtime/src/server.ts"])].sort(), ["control", "exampleMcp", "expertAgentRuntime"].sort());
  assert.deepEqual([...affectedImages(["apps/runner/src/index.ts"])], ["control", "runner"]);
  for (const file of ["package-lock.json", "packages/contracts/src/index.ts", "infra/docker/Dockerfile", "scripts/build-nemoclaw-sandbox.sh", ".github/workflows/release-control-plane.yml", "unknown-file"]) {
    assert.equal(affectedImages([file]).size, 8, file);
  }
});
test("malformed or cross-series predecessors are rejected; missing image metadata rebuilds it", () => {
  assert.throws(() => makePlan("v0.2.9-rc.2", registry, sha, [], previous()), /Invalid/);
  assert.throws(() => makePlan("v0.2.8-rc.1", registry, sha, [], previous()), /Invalid/);
  const prior = previous();
  prior.images.find(i => i.key === "runner").digest = "invalid";
  assert.equal(makePlan("v0.2.8-rc.2", registry, sha, [], prior).images.find(i => i.key === "runner").action, "build");
});
test("packager refuses unrelated workflows, version mismatches and RC full builds", () => {
  for (const [workflow, version] of [["untrusted.yml", "0.2.8-rc.1"], ["release.yml", "0.2.8-rc.1"], ["release-control-plane.yml", "0.2.8-rc.2"]]) {
    const result = spawnSync("bash", ["scripts/package-control-plane-chart.sh", version], {
      encoding: "utf8", env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.2.8-rc.1",
        GITHUB_WORKFLOW_REF: `owner/repo/.github/workflows/${workflow}@refs/tags/v0.2.8-rc.1` },
    });
    assert.equal(result.status, 2, result.stderr);
  }
});
test("RC workflow uses the planned matrix and handles sandbox builds separately", () => {
  const full = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const rc = parse(readFileSync(".github/workflows/release-control-plane.yml", "utf8"));
  assert(full.on.push.tags.includes("!v*.*.*-rc.*"));
  assert.deepEqual(rc.on.push.tags, ["v*.*.*-rc.*"]);
  assert.equal(rc.jobs.build.strategy.matrix, "${{ fromJSON(needs.prepare.outputs.matrix) }}");
  assert(rc.jobs.build.steps.some(s => s.run?.includes("scripts/build-nemoclaw-sandbox.sh")));
  const dockerfile = readFileSync("infra/docker/Dockerfile", "utf8");
  const expert = dockerfile.split("FROM node:22-bookworm-slim AS expert-agent-runtime\n")[1];
  assert(expert.includes("--from=expert-runtime-build"));
  assert(!expert.includes("--from=build "));
});
