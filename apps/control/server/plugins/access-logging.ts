import { definePlugin } from "nitro";
import { accessLogRecord } from "../http/access-log";

export default definePlugin((nitro) => {
  if (process.env.TALI_ACCESS_LOG_ENABLED !== "true") return;
  const started = new WeakMap<Request, number>();
  nitro.hooks.hook("request", (event) => { started.set(event.req, performance.now()); });
  nitro.hooks.hook("response", (response, event) => {
    const websocket = Boolean((response as Response & { crossws?: unknown }).crossws);
    console.info(JSON.stringify(accessLogRecord(event.req, websocket ? 101 : response.status,
      started.get(event.req) ?? performance.now(), websocket)));
  });
});
