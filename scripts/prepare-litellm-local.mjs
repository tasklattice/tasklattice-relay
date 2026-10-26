#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// The independently released Provider image is shared by development and Helm.
const values = parse(readFileSync(new URL("../charts/tali-relay/values.yaml", import.meta.url), "utf8"));
const { repository, tag } = values.images.litellm;
const image = `${values.global.imageRegistry}/${repository}:${tag}`;
if (process.argv.includes("--print")) console.log(image);
else execFileSync("docker", ["pull", image], { stdio: "inherit" });
