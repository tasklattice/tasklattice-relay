import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { parseControlReleaseTag, pinControlReleaseValues, reusedImages } from "../control-plane-release.mjs";

test("RC tag yields version, base and sequence", () => {
  assert.deepEqual(parseControlReleaseTag("v0.2.5-rc.2"), { version: "0.2.5-rc.2", baseVersion: "0.2.5", rc: "2" });
  for (const tag of ["v0.2.5", "v0.2.5-rc.0", "v0.2.5-rc.01", "v00.2.5-rc.1", "v0.2.5-rc.1-extra", "v0.2.5 RC1", "v0.2.5-rc.1\n"]) {
    assert.throws(() => parseControlReleaseTag(tag));
  }
});
test("RC chart pins every reused first-party image to the base release", () => {
  const original = parse(readFileSync("charts/tali-relay/values.yaml", "utf8"));
  const values = pinControlReleaseValues(structuredClone(original), "v0.2.5-rc.1", "ghcr.io/example");
  assert.equal(values.images.control.tag, "0.2.5-rc.1");
  assert.equal(values.images.expertAgentRuntime.tag, "0.2.5-rc.1");
  assert(!Object.values(reusedImages).includes("tali-expert-agent-runtime"));
  assert.equal(values.global.imageRegistry, "ghcr.io/example");
  for (const key of Object.keys(reusedImages)) assert.equal(values.images[key].tag, "0.2.5");
  assert.deepEqual(values.openshell, original.openshell);
  assert.deepEqual(values.images.postgres, original.images.postgres);
  original.images.newApplication = { repository: "new-app", tag: "" };
  assert.throws(() => pinControlReleaseValues(original, "v0.2.5-rc.1", "ghcr.io/example"), /Unpinned/);
});
test("release packager refuses unrelated workflows, mismatched versions and RC full builds", () => {
  for (const [workflow, version] of [["untrusted.yml", "0.2.5-rc.1"], ["release.yml", "0.2.5-rc.1"], ["release-control-plane.yml", "0.2.5-rc.2"]]) {
    const result = spawnSync("bash", ["scripts/package-control-plane-chart.sh", version], {
      encoding: "utf8",
      env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.2.5-rc.1",
        GITHUB_WORKFLOW_REF: `owner/repo/.github/workflows/${workflow}@refs/tags/v0.2.5-rc.1` },
    });
    assert.equal(result.status, 2, result.stderr);
  }
});

test("only the dedicated workflow handles RC tags and builds Control plus Expert Runtime", () => {
  const full = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const rc = parse(readFileSync(".github/workflows/release-control-plane.yml", "utf8"));
  assert(full.on.push.tags.includes("!v*.*.*-rc.*"));
  assert.deepEqual(rc.on.push.tags, ["v*.*.*-rc.*"]);
  assert.equal(rc.jobs.build.steps.find(s => s.uses?.startsWith("docker/build-push-action")).with.target, "${{ matrix.target }}");
  assert.deepEqual(rc.jobs.build.strategy.matrix.include.map(({ image, target, architecture }) => [image, target, architecture]), [
    ["tali-control", "control", "amd64"], ["tali-control", "control", "arm64"],
    ["tali-expert-agent-runtime", "expert-agent-runtime", "amd64"], ["tali-expert-agent-runtime", "expert-agent-runtime", "arm64"],
  ]);
  const dockerfile = readFileSync("infra/docker/Dockerfile", "utf8");
  const control = dockerfile.split("FROM node:22-bookworm-slim AS control\n")[1].split("FROM node:22-bookworm-slim AS demo-test")[0];
  assert(!control.includes("--from=build "));
  assert(control.includes("--from=control-build"));
  const expert = dockerfile.split("FROM node:22-bookworm-slim AS expert-agent-runtime\n")[1];
  assert(expert.includes("--from=expert-runtime-build"));
  assert(!expert.includes("--from=build "));
  const publish = rc.jobs.publish.steps.find(s => s.run?.includes("imagetools create")).run;
  assert(publish.includes("for repository in tali-control tali-expert-agent-runtime; do"));
});
