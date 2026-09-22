#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

export function parseControlReleaseTag(tag) {
  const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))-rc\.([1-9]\d*)$/.exec(tag);
  if (!match || match[0] !== tag) throw new Error("Control Plane release tag must be vMAJOR.MINOR.PATCH-rc.N (N >= 1).");
  return { version: tag.slice(1), baseVersion: match[1], rc: match[5] };
}

export const reusedImages = {
  runner: "tali-openshell-runner",
  litellm: "tali-litellm",
  exampleMcp: "demo-test",
  openclawSandbox: "tali-nemoclaw-sandbox",
  hermesSandbox: "tali-nemoclaw-hermes-sandbox",
  deepagentsSandbox: "tali-nemoclaw-deepagents-sandbox",
};

export function pinControlReleaseValues(values, tag, registry) {
  const { version, baseVersion } = parseControlReleaseTag(tag);
  values.global.imageRegistry = registry;
  values.images.control.tag = version;
  values.images.expertAgentRuntime.tag = version;
  for (const [key, repository] of Object.entries(reusedImages)) {
    if (values.images[key]?.repository !== repository) throw new Error(`Unexpected image definition: ${key}`);
    values.images[key].tag = baseVersion;
  }
  // Fail closed if a new first-party image is introduced without a reuse policy.
  for (const [key, image] of Object.entries(values.images)) {
    if (key !== "control" && !image.tag) throw new Error(`Unpinned release image: ${key}`);
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tag, path, registry] = process.argv.slice(2);
  const release = parseControlReleaseTag(tag);
  if (command === "metadata") {
    for (const [key, value] of Object.entries(release)) console.log(`${key}=${value}`);
  } else if (command === "pin-values") {
    if (!path || !registry) throw new Error("pin-values requires a values path and image registry");
    writeFileSync(path, stringify(pinControlReleaseValues(parse(readFileSync(path, "utf8")), tag, registry)));
  } else if (command === "base-images") {
    if (!path) throw new Error("base-images requires the registry argument");
    for (const image of Object.values(reusedImages)) console.log(`${path}/${image}:${release.baseVersion}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
