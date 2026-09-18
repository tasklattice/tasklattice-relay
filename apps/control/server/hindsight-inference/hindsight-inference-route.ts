import { getControlConfig } from "../config/control-config";
import { timingSafeEqual } from "node:crypto";
import { errorResponse, jsonResponse } from "../http/responses";
import {
  HindsightInferenceGateway,
  type HindsightInferenceRequest,
} from "./hindsight-inference-gateway";

function authorized(request: Request): boolean {
  const expectedToken = getControlConfig().memory.routerToken;
  const header = request.headers.get("authorization");
  if (!expectedToken || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function handleHindsightInference(
  request: Request,
  kind: HindsightInferenceRequest["kind"],
): Promise<Response> {
  if (!authorized(request)) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  try {
    const bankId = request.headers.get("x-hindsight-bank-id") ?? "";
    const body = await request.json() as Record<string, unknown>;
    if (!bankId || body.user !== bankId) {
      return jsonResponse({ error: "A consistent Hindsight Bank identifier is required." }, { status: 400 });
    }
    const gateway = new HindsightInferenceGateway(getControlConfig().memory.embeddingDimensions);
    return await gateway.infer({ bankId, body, kind });
  } catch (error) {
    return errorResponse(error);
  }
}
