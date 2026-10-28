import { randomUUID } from "node:crypto";

const requestIds = new WeakMap<Request, string>();

// Generate locally: an arbitrary inbound correlation header may contain secrets.
export function controlRequestId(request: Request): string {
  let id = requestIds.get(request);
  if (!id) {
    id = randomUUID();
    requestIds.set(request, id);
  }
  return id;
}
