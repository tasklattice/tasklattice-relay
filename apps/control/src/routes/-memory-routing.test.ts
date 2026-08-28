import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { getRouter } from "@/router";

function matchRouteIds(pathname: string) {
  const router = getRouter();
  router.update({
    context: router.options.context,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  return router.matchRoutes(pathname).map((match) => match.routeId);
}

describe("Durable Memory routes", () => {
  it("matches the resource list as an index route", () => {
    expect(matchRouteIds("/individual/memory"))
      .toContain("/$projectId/memory/");
  });

  it("matches details without rendering the list route as a parent", () => {
    const routeIds = matchRouteIds("/individual/memory/memory-1");
    expect(routeIds).toContain("/$projectId/memory/$memoryId");
    expect(routeIds).not.toContain("/$projectId/memory/");
  });
});
