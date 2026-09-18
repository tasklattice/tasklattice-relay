import { useMutation, useQuery } from "@tanstack/react-query";
import { useProject } from "@/hooks/use-project";
import { getProjectRuntime, retryProjectRuntime } from "@/services/project";
import { Button } from "@/components/ui/button";

export function ProjectRuntimeStatus() {
  const { currentProject } = useProject();
  const id = currentProject?.id;
  const runtime = useQuery({
    queryKey: ["project", id, "runtime"],
    queryFn: () => getProjectRuntime(id!),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "ready" ? 30000 : 3000,
  });
  const retry = useMutation({
    mutationFn: () => retryProjectRuntime(id!),
    onSuccess: () => runtime.refetch(),
  });
  if (!id || runtime.data?.status === "ready") return null;
  const failed = runtime.data?.status === "failed";
  const label = runtime.isError
    ? "Project status is unavailable"
    : failed
      ? "Project setup needs attention"
      : runtime.data?.status === "deleting"
        ? "Project deletion is scheduled"
        : "Project setup is in progress";
  return (
    <section
      role="status"
      aria-live="polite"
      className="mb-5 border bg-muted/30 p-4 text-sm"
    >
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-muted-foreground">
        {runtime.isError
          ? runtime.error.message
          : (runtime.data?.lastError ??
            "Resource setup runs in the background. Instances can start once the Project is ready.")}
      </p>
      {failed && currentProject?.activeRole === "admin" ? (
        <Button
          className="mt-3"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          Retry setup
        </Button>
      ) : null}
      {retry.error ? (
        <p role="alert" className="mt-2 text-destructive">
          {retry.error.message}
        </p>
      ) : null}
    </section>
  );
}
