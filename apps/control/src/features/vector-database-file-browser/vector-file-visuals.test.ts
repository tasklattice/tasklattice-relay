import { describe, expect, it } from "vitest";
import { vectorFileKind, vectorFileTypeLabel, vectorIndexStatusLabel } from "./vector-file-visuals";

describe("Vector Database file visuals", () => {
  it("maps supported document types to distinct visual roles", () => {
    expect(vectorFileKind("handbook.pdf", "application/pdf")).toBe("pdf");
    expect(vectorFileKind("roadmap.docx")).toBe("word");
    expect(vectorFileKind("overview.pptx")).toBe("slides");
    expect(vectorFileKind("metrics.xlsx")).toBe("sheet");
    expect(vectorFileKind("photo.png", "image/png")).toBe("image");
  });

  it("provides readable type and indexing labels", () => {
    expect(vectorFileTypeLabel("handbook.pdf")).toBe("PDF document");
    expect(vectorIndexStatusLabel("READY")).toBe("Indexed");
    expect(vectorIndexStatusLabel("EMBEDDING")).toBe("Embedding");
  });
});
