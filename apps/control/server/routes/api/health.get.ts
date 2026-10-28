import { defineHandler } from "nitro";
import { databaseHealth } from "../../db/prisma";
import { jsonResponse } from "../../http/responses";
import { controlConfigStatus } from "../../config/control-config";
import { originContract, resolveBrowserOrigin } from "../../http/request-origin";

export default defineHandler(async (event) => {
  const contract = originContract();
  const resolution = resolveBrowserOrigin(event.req);
  const origin = {
    ...contract,
    // How Control resolved *this* probe request. A kubelet probe arrives on the
    // Pod address and is expected to be outside the public allowlist; a probe
    // through the ingress shows what the browser will get.
    thisRequest: resolution.ok
      ? { host: resolution.host, origin: resolution.origin, resolved: true }
      : { host: resolution.host, reason: resolution.reason, resolved: false },
  };
  try {
    await databaseHealth();
    return jsonResponse({
      ok: true,
      database: "postgresql",
      runtime: "openshell",
      origin,
      config: controlConfigStatus(),
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        database: "unavailable",
        message: error instanceof Error ? error.message : "Database unavailable.",
        origin,
        config: controlConfigStatus(),
      },
      { status: 503 },
    );
  }
});
