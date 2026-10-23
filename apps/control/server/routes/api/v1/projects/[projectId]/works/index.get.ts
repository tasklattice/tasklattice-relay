import { defineHandler } from "nitro";
import { handleWorkRequest } from "../../../../../../works/work-http";
export default defineHandler((event) =>
  handleWorkRequest(event.req, "list", event.context.params?.workId),
);
