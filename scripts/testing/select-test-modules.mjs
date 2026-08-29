#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  moduleMatrix,
  selectTestModuleIds,
} from "./test-modules.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const explicitPaths = process.argv
  .filter((argument) => argument.startsWith("--path="))
  .map((argument) => argument.slice("--path=".length));
const base = argument("--base");
const head = argument("--head") ?? "HEAD";
const changedPaths = explicitPaths.length
  ? explicitPaths
  : base
    ? execFileSync("git", ["diff", "--name-only", base, head], {
        encoding: "utf8",
      }).split("\n")
    : execFileSync("git", ["diff", "--name-only", "HEAD^", head], {
        encoding: "utf8",
      }).split("\n");

const modules = selectTestModuleIds(changedPaths);
const outputs = [
  `any=${modules.length > 0}`,
  `modules=${JSON.stringify(modules)}`,
  `matrix=${JSON.stringify(moduleMatrix(modules))}`,
];
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
} else {
  console.log(outputs.join("\n"));
}
