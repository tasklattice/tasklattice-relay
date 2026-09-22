import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { parseControlReleaseTag, pinControlReleaseValues, releaseImages, affectedImages, makePlan, selectPreviousRelease, releaseMatrices, assembleReleaseManifest } from "../control-plane-release.mjs";
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
test("Sandbox release guard accepts RC and stable workflows without bypassing tag or architecture checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "relay-sandbox-guard-"));
  // Stop at the first source-preparation command: no downloads or Docker calls.
  writeFileSync(join(directory, "node"), '#!/bin/sh\necho "sandbox-guard-passed" >&2\nexit 86\n', { mode: 0o755 });
  const invoke = (overrides = {}) => spawnSync("bash", ["scripts/build-nemoclaw-sandbox.sh"], {
    encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
      CI: "true", GITHUB_ACTIONS: "true", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.2.8-rc.1",
      GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/release-control-plane.yml@refs/tags/v0.2.8-rc.1",
      NEMOCLAW_BUILD_OUTPUT: "ci-push", NEMOCLAW_AGENT_PLATFORM: "openclaw",
      NEMOCLAW_UPSTREAM_IMAGE: "example/upstream:rc", DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      NEMOCLAW_IMAGE: "example/sandbox:0.2.8-rc.1-amd64", ...overrides },
  });
  try {
    for (const agent of ["openclaw", "hermes", "deepagents"]) {
      for (const arch of ["amd64", "arm64"]) {
        const image = `example/sandbox:0.2.8-rc.1-${arch}`;
        const result = invoke({ NEMOCLAW_AGENT_PLATFORM: agent, DOCKER_DEFAULT_PLATFORM: `linux/${arch}`,
          NEMOCLAW_IMAGE: image, NEMOCLAW_HERMES_IMAGE: image, NEMOCLAW_DEEPAGENTS_IMAGE: image });
        assert.equal(result.status, 86, result.stderr);
        assert.match(result.stderr, /sandbox-guard-passed/);
      }
    }
    const stable = invoke({ GITHUB_REF_NAME: "v0.2.8", NEMOCLAW_IMAGE: "example/sandbox:0.2.8-amd64",
      GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/release.yml@refs/tags/v0.2.8" });
    assert.equal(stable.status, 86, stable.stderr);
    for (const overrides of [
      { CI: "false" }, { GITHUB_REF_TYPE: "branch" },
      { GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/unknown.yml@refs/tags/v0.2.8-rc.1" },
      { GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/release-control-plane.yml@refs/heads/main" },
      { GITHUB_REF_NAME: "v0.2.8-rc.01", GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/release-control-plane.yml@refs/tags/v0.2.8-rc.01" },
      { GITHUB_REF_NAME: "v0.2.8", GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/release-control-plane.yml@refs/tags/v0.2.8" },
      { NEMOCLAW_IMAGE: "example/sandbox:0.2.8-rc.2-amd64" },
      { NEMOCLAW_IMAGE: "example/sandbox:0.2.8-rc.1-arm64" },
    ]) assert.equal(invoke(overrides).status, 2, JSON.stringify(overrides));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("grouped matrices retain all manifests when a group needs no builds", () => {
  const full = releaseMatrices(previous());
  assert.equal(full.coreBuildMatrix.include.length, 10);
  assert.equal(full.sandboxBuildMatrix.include.length, 6);
  assert.equal(full.coreManifestMatrix.include.length, 5);
  assert.equal(full.sandboxManifestMatrix.include.length, 3);
  assert(full.coreBuildRequired && full.sandboxBuildRequired);
  const incremental = releaseMatrices(makePlan("v0.2.8-rc.2", registry, sha, ["apps/control/server/foo.ts"], previous()));
  assert.equal(incremental.coreBuildMatrix.include.length, 2);
  assert.equal(incremental.sandboxBuildRequired, false);
  assert.deepEqual(incremental.sandboxBuildMatrix, { include: [] });
  assert.equal(incremental.sandboxManifestMatrix.include.length, 3);
  assert(incremental.sandboxManifestMatrix.include.every(i => i.action === "reuse"));
});

test("release manifest requires eight matching publication receipts", () => {
  const plan = makePlan("v0.2.8-rc.2", registry, sha, [], previous());
  const receipts = plan.images.map(i => ({ key: i.key, tag: plan.tag, sourceSha: sha, reference: i.reference, digest: `sha256:${"b".repeat(64)}` }));
  const manifest = assembleReleaseManifest(plan, receipts);
  assert.equal(manifest.images.length, 8);
  assert(manifest.images.every(i => i.digest === receipts[0].digest));
  assert.equal(manifest.images.find(i => i.key === "runner").sourceTag, "v0.2.8-rc.1");
  for (const invalid of [receipts.slice(1), [...receipts.slice(1), receipts[1]],
    receipts.map((r, index) => index ? r : { ...r, sourceSha: "c".repeat(40) }),
    receipts.map((r, index) => index ? r : { ...r, tag: "v0.2.8-rc.99" }),
    receipts.map((r, index) => index ? r : { ...r, digest: "invalid" }),
    receipts.map(r => r.key === "runner" ? { ...r, digest: `sha256:${"c".repeat(64)}` } : r),
  ]) assert.throws(() => assembleReleaseManifest(plan, invalid));
});

test("per-image publication writes isolated receipts and assembly requires every image", () => {
  const directory = mkdtempSync(join(tmpdir(), "relay-rc-publication-"));
  const script = resolve("scripts/control-plane-release.mjs");
  const plan = makePlan("v0.2.8-rc.2", registry, sha, [], previous());
  const digest = `sha256:${"b".repeat(64)}`;
  writeFileSync(join(directory, "plan.json"), JSON.stringify(plan));
  writeFileSync(join(directory, "git"), `#!/bin/sh\nprintf '%s' '${sha}'\n`, { mode: 0o755 });
  writeFileSync(join(directory, "docker"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\ncase "$*" in *inspect*) printf "%s" "$TEST_DIGEST" ;; esac\n', { mode: 0o755 });
  const invoke = (command, key) => spawnSync(process.execPath, [script, command, plan.tag, "plan.json", ...(key ? [key] : [])], {
    cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
      CALL_LOG: join(directory, "calls.log"), TEST_DIGEST: digest },
  });
  try {
    assert.notEqual(invoke("assemble-manifest").status, 0);
    for (const image of plan.images) {
      const result = invoke("publish-image", image.key);
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(readFileSync(join(directory, `dist/image-receipts/${image.key}.json`), "utf8"));
      assert.equal(receipt.reference, image.reference);
      assert.equal(receipt.sourceSha, sha);
    }
    assert.equal(invoke("assemble-manifest").status, 0);
    const manifest = JSON.parse(readFileSync(join(directory, "dist/control-release/release-manifest.json"), "utf8"));
    assert.equal(manifest.images.length, 8);
    const calls = readFileSync(join(directory, "calls.log"), "utf8");
    assert(calls.includes(`${registry}/tali-control:0.2.8-rc.2-amd64 ${registry}/tali-control:0.2.8-rc.2-arm64`));
    assert(calls.includes(`--tag ${registry}/tali-openshell-runner:0.2.8-rc.2 ${registry}/tali-openshell-runner@${digest}`));
    assert.notEqual(invoke("publish-image", "unknown").status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("RC stages separate validation, grouped builds, manifests, chart and GitHub publication", () => {
  const full = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const rc = parse(readFileSync(".github/workflows/release-control-plane.yml", "utf8"));
  assert(full.on.push.tags.includes("!v*.*.*-rc.*"));
  assert.deepEqual(rc.on.push.tags, ["v*.*.*-rc.*"]);
  const jobs = rc.jobs;
  assert.deepEqual(Object.keys(jobs), ["plan", "validate", "build-core-platforms", "build-sandbox-platforms", "publish-core-manifests", "publish-sandbox-manifests", "publish-chart", "github-release"]);
  assert.equal(jobs.validate.needs, "plan");
  for (const group of ["core", "sandbox"]) {
    const build = jobs[`build-${group}-platforms`];
    const publish = jobs[`publish-${group}-manifests`];
    assert.deepEqual(build.needs, ["plan", "validate"]);
    assert.equal(build.if, `needs.plan.outputs.${group}BuildRequired == 'true'`);
    assert.equal(build.strategy.matrix, `\${{ fromJSON(needs.plan.outputs.${group}BuildMatrix) }}`);
    assert.deepEqual(publish.needs, ["plan", "validate", `build-${group}-platforms`]);
    assert(publish.if.includes("!cancelled()") && publish.if.includes("needs.validate.result == 'success'"));
    assert(publish.if.includes(`needs.build-${group}-platforms.result == 'success'`));
    assert(publish.if.includes(`needs.build-${group}-platforms.result == 'skipped' && needs.plan.outputs.${group}BuildRequired == 'false'`));
    assert.equal(publish.strategy.matrix, `\${{ fromJSON(needs.plan.outputs.${group}ManifestMatrix) }}`);
  }
  assert(jobs["build-sandbox-platforms"].steps.some(s => s.run?.includes("scripts/build-nemoclaw-sandbox.sh")));
  assert(!jobs["build-core-platforms"].steps.some(s => s.run?.includes("scripts/build-nemoclaw-sandbox.sh")));
  assert.deepEqual(jobs["publish-chart"].needs, ["plan", "validate", "publish-core-manifests", "publish-sandbox-manifests"]);
  assert(jobs["publish-chart"].if.includes("needs.publish-core-manifests.result == 'success'"));
  assert(jobs["publish-chart"].if.includes("needs.publish-sandbox-manifests.result == 'success'"));
  assert.deepEqual(jobs["github-release"].needs, ["plan", "publish-chart"]);
  assert(jobs["github-release"].if.includes("needs.publish-chart.result == 'success'"));
  assert.equal(jobs["publish-chart"].permissions.contents, "read");
  assert.deepEqual(jobs["github-release"].permissions, { contents: "write" });
  const composite = parse(readFileSync(".github/actions/publish-rc-image/action.yml", "utf8"));
  assert(composite.runs.steps.some(s => s.run?.includes('publish-image "$GITHUB_REF_NAME"')));
  assert(composite.runs.steps.some(s => s.with?.name === "rc-image-receipt-${{ inputs.image-key }}"));
  const dockerfile = readFileSync("infra/docker/Dockerfile", "utf8");
  const expert = dockerfile.split("FROM node:22-bookworm-slim AS expert-agent-runtime\n")[1];
  assert(expert.includes("--from=expert-runtime-build"));
  assert(!expert.includes("--from=build "));
});
