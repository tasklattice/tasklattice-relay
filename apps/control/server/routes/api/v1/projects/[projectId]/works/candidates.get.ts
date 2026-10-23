import { defineHandler } from "nitro";
import { handleWorkRequest } from "../../../../../../works/work-http";
export default defineHandler((event) =>
  handleWorkRequest(event.req, "candidates", event.context.params?.workId),
);
