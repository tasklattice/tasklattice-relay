import { readFileSync } from "node:fs";
import { expect, it, describe } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
function declarations(selector: string) {
  const start = css.indexOf(`${selector} {\n`);
  if (start < 0) throw new Error(`Missing theme: ${selector}`);
  return Object.fromEntries([...css.slice(start, css.indexOf("\n}", start))
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
}
const light = declarations(":root");
const dark = { ...light, ...declarations(".dark") };
function color(tokens: Record<string, string>, key: string): string {
  const value = tokens[key];
  if (!value) throw new Error(`Missing token ${key}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? color(tokens, reference[1]!) : value;
}
function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Not a color: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}
function contrast(tokens: Record<string, string>, foreground: string, background: string) {
  const [lo, hi] = [luminance(color(tokens, foreground)), luminance(color(tokens, background))].sort((a, b) => a - b);
  return (hi! + 0.05) / (lo! + 0.05);
}
const textPairs = [
  ["--foreground", "--background"], ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"], ["--muted-foreground", "--card"],
  ["--muted-foreground", "--popover"], ["--link", "--card"],
  ["--primary-foreground", "--primary"], ["--primary-foreground", "--primary-hover"],
  ["--primary-foreground", "--primary-active"], ["--accent-foreground", "--accent"],
  ["--edit-foreground", "--edit-surface"], ["--edit-foreground", "--edit-hover"],
  ...["success", "warning", "destructive", "info"].map((role) => [`--${role}`, `--${role}-surface`]),
];
for (const [name, tokens] of Object.entries({ light, dark })) {
  describe(`${name} theme contrast`, () => {
    it.each(textPairs)("keeps %s readable on %s", (foreground, background) => {
      expect(contrast(tokens, foreground!, background!)).toBeGreaterThanOrEqual(4.5);
    });
    it.each(["--input", "--ring"])("keeps %s visible against the working surface", (token) => {
      expect(contrast(tokens, token, "--card")).toBeGreaterThanOrEqual(3);
    });
  });
}
it("keeps login and its portaled menu light under a dark workspace", () => {
  const login = declarations('body:has(.login-page) [data-slot="select-content"]');
  for (const token of ["--background", "--foreground", "--input", "--ring", "--popover", "--popover-foreground"]) {
    expect(color(login, token)).toBe(color(light, token));
  }
});
