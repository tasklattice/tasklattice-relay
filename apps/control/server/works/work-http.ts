import { ProjectService } from "../projects/project-service";
import { errorResponse, jsonResponse } from "../http/responses";
import { WorkService } from "./work-service";
import { WorkError } from "./work-domain";
import { z } from "zod";

export async function handleWorkRequest(
  request: Request,
  operation:
    "list" | "create" | "candidates" | "snapshot" | "command" | "events",
  workId?: string,
) {
  try {
    const { projectId, userId, activeRole } =
      await new ProjectService().resolve(request);
    const service = new WorkService();
    if (
      ["create", "command"].includes(operation) &&
      !["user", "admin", "developer"].includes(activeRole)
    )
      throw new WorkError("当前角色不能修改工作群。", 403);
    if (operation === "list")
      return jsonResponse(await service.list(projectId, userId));
    if (operation === "candidates")
      return jsonResponse(await service.candidates(projectId, userId));
    if (operation === "create" || operation === "command") {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 64_000)
        throw new WorkError("请求内容过长。", 413);
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new WorkError("无效的请求内容。", 400);
      }
      return jsonResponse(
        operation === "create"
          ? await service.create(projectId, userId, data)
          : await service.command(
              projectId,
              z.string().uuid().parse(workId),
              userId,
              data,
            ),
      );
    }
    const id = z.string().uuid().parse(workId);
    if (operation === "snapshot")
      return jsonResponse(await service.snapshot(projectId, id, userId), {
        headers: { "cache-control": "no-store" },
      });
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(2147483647)
      .parse(new URL(request.url).searchParams.get("after") ?? "0");
    // Durable cursor feed: repeat requests are safe. Clients fetch an atomic
    // snapshot after events and reconnect using its revision, never local deltas.
    return jsonResponse(await service.events(projectId, id, userId, after), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
