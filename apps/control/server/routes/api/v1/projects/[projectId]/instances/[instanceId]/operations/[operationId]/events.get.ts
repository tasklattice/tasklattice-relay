import { defineHandler } from "nitro";
import { instanceOperationParamsSchema } from "../../../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, problemResponse } from "../../../../../../../../../http/responses";
import { getInstanceService } from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId, operationId } = instanceOperationParamsSchema.parse(
      event.context.params,
    );
    const lifecycle = (await getInstanceService(event.req)).lifecycle;
    const initial = await lifecycle.get(operationId);
    if (!initial || initial.instanceId !== instanceId) {
      return problemResponse(404, "Instance lifecycle operation not found.");
    }

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastRevision = 0;
    let reading = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (timer) clearInterval(timer);
          timer = undefined;
          try {
            controller.close();
          } catch {
            // The client may already have closed the stream.
          }
        };
        const emit = async () => {
          if (reading) return;
          reading = true;
          try {
            const operation = await lifecycle.get(operationId);
            if (!operation || operation.instanceId !== instanceId) {
              close();
              return;
            }
            if (operation.revision !== lastRevision) {
              lastRevision = operation.revision;
              controller.enqueue(encoder.encode(
                `id: ${operation.revision}\ndata: ${JSON.stringify(operation)}\n\n`,
              ));
            } else {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }
            if (operation.status === "succeeded" || operation.status === "failed") {
              close();
            }
          } catch (error) {
            controller.error(error);
            if (timer) clearInterval(timer);
            timer = undefined;
          } finally {
            reading = false;
          }
        };
        event.req.signal.addEventListener("abort", close, { once: true });
        void emit();
        timer = setInterval(() => void emit(), 1_000);
      },
      cancel() {
        if (timer) clearInterval(timer);
        timer = undefined;
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
