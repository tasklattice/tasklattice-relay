import { createFileRoute } from "@tanstack/react-router";
import { MemoryDetailPage } from "@/features/memory/memory-detail-page";

export const Route = createFileRoute("/$projectId/memory/$memoryId")({
  component: MemoryDetailRoute,
});

function MemoryDetailRoute() {
  const { memoryId } = Route.useParams();
  return <MemoryDetailPage memoryId={memoryId} />;
}
