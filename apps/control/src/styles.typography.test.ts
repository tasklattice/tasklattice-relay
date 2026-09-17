import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("Control Plane typography contract", () => {
  it("keeps the angular ToB shape tokens and mobile drawer contract", () => {
    expect(styles).toContain("--radius-control: 0.125rem;");
    expect(styles).toContain("--radius-card: 0.25rem;");
    expect(styles).toContain("--radius-large: 0.25rem;");
    expect(styles).toContain("--sidebar-item-radius: var(--radius-control);");
    expect(styles).toContain('[data-slot="sheet-content"][data-side="right"]');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("defines display, interface, and technical font roles", () => {
    expect(styles).toContain("--font-display:");
    expect(styles).toContain("--font-sans:");
    expect(styles).toContain("--font-mono:");
    expect(styles).toContain('--font-display: "Inter"');
    expect(styles).toContain('--font-sans: "Inter"');
    expect(styles).not.toContain("--font-heading:");
  });

  it("does not assign a font family from heading level", () => {
    expect(styles).not.toMatch(/h1,\s*h2,\s*h3/);
  });

  it("uses the technical font for native code elements", () => {
    expect(styles).toMatch(/code,\s*kbd,\s*samp,\s*pre\s*{\s*@apply font-mono;/);
  });

  it("uses the Traditional Chinese sans family for zh-TW documents", () => {
    expect(styles).toContain(':root:lang(zh-TW)');
    expect(styles).toContain('"Noto Sans TC"');
    expect(styles).not.toContain('"Noto Serif TC"');
    expect(styles).toMatch(/:root:lang\(zh-TW\) body,/);
    expect(styles).toMatch(/:root:lang\(zh-TW\) \.font-display/);
  });
});
