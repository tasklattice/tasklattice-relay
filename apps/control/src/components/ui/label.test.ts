import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Label } from "./label";

describe("Label", () => {
  it("renders one visible red star and a screen-reader required cue", () => {
    const markup = renderToStaticMarkup(
      createElement(Label, { htmlFor: "name", required: true }, "Name"),
    );

    expect(markup).toContain("text-destructive");
    expect(markup).toContain('aria-hidden="true">*</span>');
    expect(markup).toContain(">Required</span>");
  });

  it("does not add a required cue to optional labels", () => {
    const markup = renderToStaticMarkup(
      createElement(Label, { htmlFor: "description" }, "Description"),
    );

    expect(markup).not.toContain("text-destructive");
    expect(markup).not.toContain(">Required</span>");
  });
});
