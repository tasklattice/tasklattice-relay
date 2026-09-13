import type { ProviderConnectionDraft } from "@tali/contracts";
import { Label } from "@/components/ui/label";
import type { ProviderConfiguratorProps } from "./types";
import { ProviderFormSection, ProviderTextField } from "./fields";

type Draft = Extract<ProviderConnectionDraft, { provider: "moonshot" }>;

export function MoonshotProvider({ disabled, errors, onChange, value }: ProviderConfiguratorProps<Draft>) {
  return (
    <ProviderFormSection title="Moonshot credentials" description="Choose the endpoint region associated with your API key.">
      <div className="space-y-2">
        <Label htmlFor="moonshot-region">Endpoint region</Label>
        <select
          id="moonshot-region"
          value={value.config.region}
          disabled={disabled}
          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-50"
          onChange={(event) => {
            const selected = event.target.value;
            if (selected !== "cn" && selected !== "global") return;
            const region = selected === "cn" ? "cn" : "global";
            onChange({ ...value, config: { ...value.config, region, endpoint: region === "cn" ? "https://api.moonshot.cn/v1" : "https://api.moonshot.ai/v1" } });
          }}
        >
          <option value="global">Global</option>
          <option value="cn">Mainland China</option>
        </select>
      </div>
      <ProviderTextField id="moonshot-endpoint" label="API endpoint" type="url" required value={value.config.endpoint} disabled={disabled} error={errors.endpoint} onChange={(endpoint) => onChange({ ...value, config: { ...value.config, endpoint } })} />
      <ProviderTextField id="moonshot-key" label="API key" type="password" required value={value.credentials.apiKey} disabled={disabled} error={errors.apiKey} onChange={(apiKey) => onChange({ ...value, credentials: { apiKey } })} />
    </ProviderFormSection>
  );
}
