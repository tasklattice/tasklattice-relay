import { createFileRoute } from "@tanstack/react-router";
import { MemoryListPage } from "@/features/memory/memory-list-page";

export const Route = createFileRoute("/$projectId/memory/")({
  component: MemoryListPage,
});
