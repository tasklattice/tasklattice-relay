import type { ProjectStore } from "../projects/project-store";
import { WorkError } from "./work-domain";

/** Keep keys scoped to the published routing identity, including SINGLE routes
 * whose public alias is resolved by LiteLLM on the key rather than globally. */
export async function workModelKeyConfiguration(store: ProjectStore, routingId: string, modelAlias: string) {
  const routing = await store.getModelRouting(routingId);
  if (!routing || routing.status !== "READY" || routing.publicModelAlias !== modelAlias)
    throw new WorkError("模型路由已改变或未就绪，请重新检查配置。", 409);
  const routerSettings = { num_retries: 0, fallbacks: [] };
  if (routing.routingPolicy.mode !== "SINGLE") return { routerSettings };
  const model = await store.getModelDeployment(routing.routingPolicy.modelDeploymentId);
  if (!model || model.status !== "VALIDATED" || !model.litellmModelName)
    throw new WorkError("路由引用的模型不可用。", 409);
  return { aliases: { [modelAlias]: model.litellmModelName }, routerSettings };
}
