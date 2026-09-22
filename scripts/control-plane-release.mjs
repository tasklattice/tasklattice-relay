#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

export function parseControlReleaseTag(tag) {
  const m = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-rc\.([1-9]\d*)$/.exec(tag);
  if (!m || m[0] !== tag) throw new Error("Expected vMAJOR.MINOR.PATCH-rc.N");
  return { version: tag.slice(1), series: m[1], rc: m[2] };
}
export const releaseImages = {
  control: { image: "tali-control", target: "control" },
  runner: { image: "tali-openshell-runner", target: "runner" },
  expertAgentRuntime: { image: "tali-expert-agent-runtime", target: "expert-agent-runtime" },
  litellm: { image: "tali-litellm", target: "", dockerfile: "infra/docker/Dockerfile.litellm" },
  exampleMcp: { image: "demo-test", target: "demo-test" },
  openclawSandbox: { image: "tali-nemoclaw-sandbox", agent: "openclaw" },
  hermesSandbox: { image: "tali-nemoclaw-hermes-sandbox", agent: "hermes" },
  deepagentsSandbox: { image: "tali-nemoclaw-deepagents-sandbox", agent: "deepagents" },
};
export function pinControlReleaseValues(values, tag, registry) {
  const { version } = parseControlReleaseTag(tag);
  values.global.imageRegistry = registry;
  for (const [key, { image }] of Object.entries(releaseImages)) {
    if (values.images[key]?.repository !== image) throw new Error(`Unexpected image definition: ${key}`);
    values.images[key].tag = version;
  }
  for (const [key, image] of Object.entries(values.images)) {
    if (!image.tag) throw new Error(`Unpinned release image: ${key}`);
  }
  return values;
}
// Conservative transitive dependencies. Unclassified changes rebuild everything.
export function affectedImages(paths) {
  const all = Object.keys(releaseImages);
  const affected = new Set(["control"]); // embedded versioned chart always changes
  for (const path of paths) {
    let keys;
    if (path.startsWith("apps/control/") || path.startsWith("charts/") || path.startsWith("docs/") || path.startsWith("artifacts/")) keys = ["control"];
    else if (path.startsWith("apps/runner/")) keys = ["runner"];
    else if (path.startsWith("apps/expert-agent-runtime/")) keys = ["control", "expertAgentRuntime", "exampleMcp"];
    else if (path.startsWith("apps/example-mcp-server/")) keys = ["exampleMcp"];
    else keys = all; // lockfiles, contracts, Dockerfiles, scripts, workflow, upstream pins
    keys.forEach(key => affected.add(key));
  }
  return affected;
}
export function makePlan(tag, registry, sourceSha, paths, previous) {
  const release = parseControlReleaseTag(tag);
  if (previous) {
    const prior = parseControlReleaseTag(previous.tag);
    if (prior.series !== release.series || BigInt(prior.rc) >= BigInt(release.rc)
      || previous.version !== prior.version || !Array.isArray(previous.images)
      || previous.schema !== 1 || !/^[a-f0-9]{40}$/.test(previous.sourceSha)) throw new Error("Invalid previous RC manifest");
  }
  const changed = previous ? affectedImages(paths) : new Set(Object.keys(releaseImages));
  const images = Object.entries(releaseImages).map(([key, spec]) => {
    const prior = previous?.images?.find(i => i.key === key);
    const reusable = prior && prior.reference === `${registry}/${spec.image}:${previous.version}`
      && /^sha256:[a-f0-9]{64}$/.test(prior.digest);
    return { key, ...spec, dockerfile: spec.dockerfile ?? "infra/docker/Dockerfile", target: spec.target ?? "",
      reference: `${registry}/${spec.image}:${release.version}`,
      action: !changed.has(key) && reusable ? "reuse" : "build",
      ...(!changed.has(key) && reusable ? { source: `${registry}/${spec.image}@${prior.digest}`, sourceTag: previous.tag } : {}),
    };
  });
  return { schema: 1, tag, ...release, sourceSha, previousTag: previous?.tag ?? null, images };
}
export function selectPreviousRelease(tag, releases) {
  const release = parseControlReleaseTag(tag);
  if (release.rc === "1") return undefined;
  return releases.filter(r => !r.draft && r.prerelease).filter(r => {
    try {
      const prior = parseControlReleaseTag(r.tag_name);
      return prior.series === release.series && BigInt(prior.rc) < BigInt(release.rc);
    } catch { return false; }
  }).sort((a, b) => BigInt(parseControlReleaseTag(a.tag_name).rc) > BigInt(parseControlReleaseTag(b.tag_name).rc) ? -1 : 1)[0];
}
const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const gh = args => run("gh", args);
const inspect = reference => {
  const digest = run("docker", ["buildx", "imagetools", "inspect", reference, "--format", "{{.Manifest.Digest}}"]);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid digest for ${reference}`);
  return digest;
};
async function cli() {
  const [command, tag, path, registryArg] = process.argv.slice(2);
  const release = parseControlReleaseTag(tag);
  if (command === "metadata") {
    for (const [key, value] of Object.entries(release)) console.log(`${key}=${value}`);
  } else if (command === "pin-values") {
    writeFileSync(path, stringify(pinControlReleaseValues(parse(readFileSync(path, "utf8")), tag, registryArg)));
  } else if (command === "plan") {
    const registry = path;
    const repo = process.env.GITHUB_REPOSITORY;
    const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`]));
    const releases = pages.flat();
    if (releases.some(r => r.tag_name === tag)) throw new Error("RC already released; use a new tag");
    let previous;
    const candidate = selectPreviousRelease(tag, releases);
    if (candidate?.assets.some(a => a.name === "release-manifest.json")) {
      mkdirSync("dist/previous-rc", { recursive: true });
      gh(["release", "download", candidate.tag_name, "--repo", repo, "--pattern", "release-manifest.json", "--dir", "dist/previous-rc", "--clobber"]);
      previous = JSON.parse(readFileSync("dist/previous-rc/release-manifest.json", "utf8"));
      if (previous.tag !== candidate.tag_name || run("git", ["rev-parse", `${candidate.tag_name}^{commit}`]) !== previous.sourceSha) throw new Error("Previous RC tag/manifest mismatch");
      // Divergent histories are not eligible for incremental reuse.
      try { run("git", ["merge-base", "--is-ancestor", previous.sourceSha, "HEAD"]); } catch { previous = undefined; }
    }
    const paths = previous ? run("git", ["diff", "--name-only", "--no-renames", previous.sourceSha, "HEAD"]).split("\n").filter(Boolean) : [];
    const plan = makePlan(tag, registry, run("git", ["rev-parse", "HEAD"]), paths, previous);
    // Validate reusable content exists before any expensive build.
    for (const image of plan.images.filter(i => i.action === "reuse")) inspect(image.source);
    mkdirSync("dist/control-release", { recursive: true });
    writeFileSync("dist/control-release/plan.json", JSON.stringify(plan, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## ${tag}\nPrevious successful RC: ${plan.previousTag ?? "none (full build)"}\n\n| Image | Action | Reuse source |\n|---|---|---|\n`
      + plan.images.map(i => `| ${i.image} | ${i.action} | ${i.source ?? "current commit"} |`).join("\n") + "\n");
    const matrix = { include: plan.images.filter(i => i.action === "build").flatMap(image => ["amd64", "arm64"].map(architecture => ({
      ...image, architecture, runner: architecture === "amd64" ? "ubuntu-24.04" : "ubuntu-24.04-arm", agent: image.agent ?? "",
    }))) };
    console.log(`matrix=${JSON.stringify(matrix)}`);
  } else if (command === "publish-images") {
    const plan = JSON.parse(readFileSync(path, "utf8"));
    if (plan.tag !== tag || plan.sourceSha !== run("git", ["rev-parse", "HEAD"])) throw new Error("Plan does not match checkout");
    for (const image of plan.images) {
      const sources = image.action === "reuse" ? [image.source] : ["amd64", "arm64"].map(arch => `${image.reference}-${arch}`);
      run("docker", ["buildx", "imagetools", "create", "--tag", image.reference, ...sources]);
      image.digest = inspect(image.reference);
      if (image.action === "reuse" && image.digest !== image.source.split("@")[1]) throw new Error("Reused manifest digest changed");
    }
    writeFileSync("dist/control-release/release-manifest.json", JSON.stringify(plan, null, 2));
  } else throw new Error(`Unknown command: ${command}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli();
