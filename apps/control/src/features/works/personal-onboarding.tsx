import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, LoaderCircle, KeyRound, Users } from "lucide-react";
import type { PersonalOnboardingStatus } from "@tali/contracts";
import { Button } from "@/components/ui/button";

const providers = {
  openai: { name: "OpenAI", endpoint: "https://api.openai.com/v1" },
  deepseek: { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1" },
  openrouter: { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  "nvidia-nim": { name: "NVIDIA NIM", endpoint: "https://integrate.api.nvidia.com/v1" },
  "custom-openai-compatible": { name: "兼容 OpenAI 的服务", endpoint: "" },
};
export function PersonalOnboarding({ projectId, status, onContinue, onSkip, onBegin }: {
  projectId: string; status: PersonalOnboardingStatus; onContinue: () => void; onSkip: () => void; onBegin: () => void;
}) {
  const client = useQueryClient();
  const [provider, setProvider] = useState<keyof typeof providers>("openai");
  const [endpoint, setEndpoint] = useState(providers.openai.endpoint);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("5");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const connected = Boolean(status.state.modelDeploymentId), ready = status.status === "READY";
  const pending = busy || status.busy;
  async function submit() {
    onBegin();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/personal-onboarding/${connected ? "prepare" : "connect"}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(connected ? { expectedRevision: status.revision } : { expectedRevision: status.revision, provider, endpoint, apiKey, modelId, budgetUsd: Number(budgetUsd) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "设置未保存，请刷新后重试。");
      // Credentials remain in this form only until the successful connection.
      if (result.state?.modelDeploymentId) setApiKey("");
      await client.invalidateQueries({ queryKey: ["personal-onboarding", projectId] });
      await client.invalidateQueries({ queryKey: ["work-candidates", projectId] });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "连接中断。请先刷新准备状态，确认后再试。"); }
    finally { setBusy(false); }
  }
  return <main className="work-onboarding">
    <div className="work-onboarding-body">
      <section className="work-onboarding-form">
        <div className="work-onboarding-steps" aria-label="设置进度"><span data-current={!connected}>01 连接模型</span><span data-current={connected && !ready}>02 准备团队</span><span data-current={ready}>03 开始工作</span></div>
        <h1>{ready ? "你的团队，准备好了。" : connected ? "让专家准备好，等你开工。" : "接上模型，就可以开始了。"}</h1>
        <p className="work-onboarding-intro">{ready ? "说出目标，协调者负责规划，专家负责整理草稿。你随时可以调整方向。" : connected ? "我们会验证模型、发布默认角色，并为新工作群自动分配团队。以后需要时再微调。" : "你的个人 Project 已创建。使用自己的模型账户，Relay 会自动准备协调者和工作专家。"}</p>
        {!connected ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label>模型服务商 · Provider<select value={provider} disabled={pending} onChange={(e) => { const next = e.target.value as keyof typeof providers; setProvider(next); setEndpoint(providers[next].endpoint); setModelId(""); }}>
            {Object.entries(providers).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
          </select></label>
          {provider === "custom-openai-compatible" ? <label>服务地址<input type="url" required value={endpoint} disabled={pending} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-provider.example/v1" /></label> : <p className="work-caption">连接至 {endpoint}</p>}
          <label>API Key<input type="password" autoComplete="off" spellCheck={false} required value={apiKey} disabled={pending} onChange={(e) => setApiKey(e.target.value)} placeholder="粘贴此 Provider 的 API Key" /></label>
          <p className="work-caption">密钥加密保存在当前 Relay 部署中，不会写入聊天或返回给客户端。</p>
          <label>模型 · Model<input required value={modelId} maxLength={160} disabled={pending} onChange={(e) => setModelId(e.target.value)} placeholder="填写账户中可用的模型名称" /></label>
          <label>每 30 天的 Project 预算（美元）<input type="number" required min="0.01" max="100" step="0.01" value={budgetUsd} disabled={pending} onChange={(e) => setBudgetUsd(e.target.value)} /></label>
          <p className="work-caption">费用由你的 Provider 收取。连接验证会发出少量探测请求；探测费用可能不计入 Project 预算，请同时设置 Provider 账户限额。</p>
          <Button disabled={pending || !apiKey.trim() || !modelId.trim() || !endpoint.trim()}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? "正在验证连接…" : "验证并继续"}</Button>
        </form> : <div className="work-onboarding-summary">
          <dl><div><dt>模型</dt><dd>{status.state.modelId}</dd></div><div><dt>预算</dt><dd>${status.state.budgetUsd} / 30 天</dd></div></dl>
          <p>{ready ? "新工作群会自动带上两个专家角色。当前支持基于已有材料的文本分析与草拟。" : "准备过程将为每个角色调用一次模型，检查结构化输出。验证成功后才会显示就绪；这不代表内容准确性已获认证。"}</p>
          <Button disabled={pending} onClick={ready ? onContinue : () => void submit()}>{pending ? <LoaderCircle className="animate-spin" /> : ready ? <ArrowRight /> : <Users />}{pending ? "正在准备，请稍候…" : ready ? "开始第一件工作" : status.status === "ERROR" || status.interrupted ? "确认并继续准备" : "准备我的团队"}</Button>
        </div>}
        {(error || status.error || status.interrupted) && <p role="alert" className="work-onboarding-error">{error || status.error || "上次准备中断。已保存的资源会保留；继续会重新验证未完成的步骤，可能产生费用。"}</p>}
        <button className="work-onboarding-skip" disabled={pending} onClick={onSkip}>{ready ? "返回工作群" : "稍后设置，先记录想法"}</button>
      </section>
      <aside className="work-onboarding-team" aria-label="默认团队预览">
        <span className="work-onboarding-team-label">你的第一个工作团队</span>
        <article><span className="work-onboarding-symbol"><KeyRound size={22} /></span><div><h2>一个模型连接</h2><p>两个角色共用，预算集中管理。</p></div>{connected && <Check aria-label="模型已连接" />}</article>
        <article><span className="work-avatar">协</span><div><h2>工作协调者</h2><p>理解目标、安排任务、跟进变化。</p></div>{status.state.coordinatorInstanceId && <Check aria-label="协调者已就绪" />}</article>
        <article><span className="work-avatar">专</span><div><h2>工作专家</h2><p>整理材料、分析问题、交付草稿。</p></div>{status.state.expertInstanceId && <Check aria-label="专家已就绪" />}</article>
        <p className="work-caption">{ready ? "准备完成。开始工作后，你始终可以查看计划、调用记录和成果。" : "这些是待准备的角色。连接与验证完成之前，不会产生虚假的对话或任务。"}</p>
      </aside>
    </div>
  </main>;
}
