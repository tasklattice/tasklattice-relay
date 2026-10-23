import { ProjectService } from "./project-service";
import { PersonalOnboardingService } from "./personal-onboarding-service";
import { errorResponse, jsonResponse } from "../http/responses";
import { WorkError } from "../works/work-domain";

export async function handlePersonalOnboarding(request: Request, operation: "status" | "connect" | "prepare") {
  try {
    const { projectId, userId, activeRole } = await new ProjectService().resolve(request);
    const service = new PersonalOnboardingService();
    if (operation === "status") return jsonResponse(await service.status(projectId, userId), { headers: { "cache-control": "no-store" } });
    if (activeRole !== "user") throw new WorkError("请使用个人用户身份完成初始化。", 403);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 20000) throw new WorkError("设置内容过长。", 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new WorkError("设置内容无效。", 400); }
    return jsonResponse(await service[operation](projectId, userId, input), { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
