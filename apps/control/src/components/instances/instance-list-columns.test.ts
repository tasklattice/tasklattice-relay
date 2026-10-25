import { describe, expect, it } from "vitest";
import {
  defaultHiddenInstanceColumns,
  instanceListGridTemplate,
  parseHiddenInstanceColumns,
  toggleHiddenInstanceColumn,
} from "./instance-list-columns";

describe("Instance list column preferences", () => {
  it("defaults safely when local storage does not contain a supported list", () => {
    expect(parseHiddenInstanceColumns(null)).toEqual(defaultHiddenInstanceColumns);
    expect(parseHiddenInstanceColumns("not-json")).toEqual(defaultHiddenInstanceColumns);
    expect(parseHiddenInstanceColumns('{"createdAt":false}')).toEqual(defaultHiddenInstanceColumns);
  });

  it("preserves an explicit choice to show every column", () => {
    expect(parseHiddenInstanceColumns("[]")).toEqual([]);
  });

  it("keeps supported columns once and in the product-defined order", () => {
    expect(
      parseHiddenInstanceColumns(
        JSON.stringify(["updatedAt", "unknown", "version", "updatedAt"]),
      ),
    ).toEqual(["version", "updatedAt"]);
  });

  it("toggles a column without disturbing the stable column order", () => {
    expect(toggleHiddenInstanceColumn(["updatedAt"], "version")).toEqual([
      "version",
      "updatedAt",
    ]);
    expect(
      toggleHiddenInstanceColumn(["version", "updatedAt"], "version"),
    ).toEqual(["updatedAt"]);
  });

  it("removes hidden tracks while retaining the identity and actions tracks", () => {
    const visible = instanceListGridTemplate([]);
    const hidden = instanceListGridTemplate(["version", "updatedAt"]);

    expect(visible).toContain("minmax(13rem,1.3fr)");
    expect(visible).toContain("minmax(7.5rem,.65fr)");
    expect(hidden).not.toContain("minmax(7.5rem,.65fr)");
    expect(hidden.endsWith("3rem")).toBe(true);
  });
});
