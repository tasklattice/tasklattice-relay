import { createFileRoute, redirect, type SearchSchemaInput } from "@tanstack/react-router";
import { MemoryDetailPage, type MemoryDetailTab } from "@/features/memory/memory-detail-page";

export const Route = createFileRoute("/$projectId/memory/$memoryId")({
  validateSearch: (search: { tab?: unknown } & SearchSchemaInput): { tab: MemoryDetailTab } => ({
    tab: search.tab === "conversations" || search.tab === "facts"
      || search.tab === "experiences" || search.tab === "settings"
      ? search.tab : "overview",
  }),
  beforeLoad: ({ location, params, search }) => {
    if (new URLSearchParams(location.searchStr).get("tab") !== search.tab) {
      throw redirect({
        to: "/$projectId/memory/$memoryId",
        params,
        search,
        replace: true,
      });
    }
  },
  component: MemoryDetailRoute,
});

function MemoryDetailRoute() {
  const { memoryId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <MemoryDetailPage memoryId={memoryId} tab={tab} onTabChange={(next) => {
    void navigate({ search: { tab: next }, resetScroll: false });
  }} />;
}
