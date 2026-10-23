import { describe, expect, it } from "vitest";
import { projectRouteAdmissionPolicy } from "../authorization/route-capabilities";
import { routeMatchesAccessContext } from "../../src/components/auth/access-context-guard";

describe("Work admission preserves Project and role boundaries", () => {
  it("covers only the explicit Work API surface", () => {
    for (const [method, path] of [
      ["GET", "works"],
      ["POST", "works"],
      ["GET", "works/candidates"],
      ["GET", "works/id"],
      ["GET", "works/id/events"],
      ["POST", "works/id/commands"],
    ]) {
      expect(
        projectRouteAdmissionPolicy(method!, `/api/v1/projects/project/${path}`)
          ?.requirements,
      ).toEqual([{ capability: "CAP_PROJECT_VIEW", resourceType: "Work" }]);
    }
    expect(
      projectRouteAdmissionPolicy(
        "DELETE",
        "/api/v1/projects/project/works/id",
      ),
    ).toBeUndefined();
    expect(
      projectRouteAdmissionPolicy(
        "POST",
        "/api/v1/projects/project/works/id/unchecked-tool",
      ),
    ).toBeUndefined();
  });
  it("does not let platform or another Project's context enter Work", () => {
    const context = {
      id: "context",
      description: "",
      level: "project" as const,
      resourceId: "p1",
      resourceName: "P1",
      roleId: "ROLE_USER" as const,
      roleLabel: "User",
      target: "/p1",
    };
    expect(routeMatchesAccessContext("/p1/works", context)).toBe(true);
    expect(routeMatchesAccessContext("/p2/works", context)).toBe(false);
    expect(
      routeMatchesAccessContext("/p1/works", {
        ...context,
        level: "platform",
        resourceId: null,
        roleId: "ROLE_PLATFORM_ADMIN",
      }),
    ).toBe(false);
  });
});
