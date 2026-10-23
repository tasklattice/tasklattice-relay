import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WorkPage } from "@/features/works/work-page";
export const Route = createFileRoute("/$projectId/works")({
  validateSearch: z.object({ work: z.string().uuid().optional() }),
  component: WorkPage,
});
