import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CursorPagination,
  formatMemoryDate,
  memoryEmptyCopy,
  MemoryConflictNotice,
  MemoryErrorState,
  MemoryLoadingRows,
  MemoryNotice,
  MemoryStatus,
} from "./memory-ui";

describe("Durable Memory presentation states", () => {
  it("renders actionable degraded and deletion-failed status labels", () => {
    const degraded = renderToStaticMarkup(createElement(MemoryStatus, { status: "degraded" }));
    const deletionFailed = renderToStaticMarkup(createElement(MemoryStatus, { status: "deletion_failed" }));
    expect(degraded).toContain("Degraded");
    expect(deletionFailed).toContain("Deletion failed");
  });

  it("announces success and error states with semantic live regions", () => {
    const success = renderToStaticMarkup(createElement(MemoryNotice, {
      tone: "success",
      children: "Memory attached.",
    }));
    const error = renderToStaticMarkup(createElement(MemoryErrorState, {
      error: new Error("Provider is unavailable."),
      onRetry: () => undefined,
    }));
    expect(success).toContain('role="status"');
    expect(error).toContain('role="alert"');
    expect(error).toContain("Provider is unavailable.");
    expect(error).toContain("Retry");
  });

  it("renders stable loading, empty, and optimistic-conflict recovery states", () => {
    const loading = renderToStaticMarkup(createElement(MemoryLoadingRows));
    const conflict = renderToStaticMarkup(createElement(MemoryConflictNotice, {
      entity: "Experience",
      onReload: () => undefined,
    }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-label="Loading Memory resources"');
    expect(memoryEmptyCopy(false)).toMatchObject({ title: "No Durable Memory yet" });
    expect(memoryEmptyCopy(true)).toMatchObject({ title: "No matching Memory" });
    expect(conflict).toContain("newer version");
    expect(conflict).toContain("Reload Experience");
  });

  it("disables unavailable cursor actions and reports the real total", () => {
    const markup = renderToStaticMarkup(createElement(CursorPagination, {
      canNext: false,
      canPrevious: false,
      itemCount: 0,
      totalCount: 0,
      onNext: () => undefined,
      onPrevious: () => undefined,
    }));
    expect(markup).toContain("Showing 0 of 0");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("does not invent a date for missing or invalid activity", () => {
    expect(formatMemoryDate(null)).toBe("Never");
    expect(formatMemoryDate("not-a-date")).toBe("Unknown");
  });
});
