import { afterEach, describe, expect, it, vi } from "vitest";
import { LiteLLMClient } from "./litellm-client";

afterEach(() => vi.unstubAllGlobals());

const input = {
  alias: "tali-instance-ti-pi",
  projectId: "tp-project",
  instanceId: "ti-pi",
};
const ownedKey = {
  key_alias: input.alias,
  token: "a".repeat(64),
  metadata: {
    managed_by: "tali",
    tali_project_id: input.projectId,
    tali_instance_id: input.instanceId,
  },
};

function setup(keys: unknown[], totalPages = 1) {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      keys, total_pages: totalPages,
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, client: new LiteLLMClient("http://litellm:4000", "master-secret") };
}

describe("interrupted Instance key provisioning", () => {
  it("revokes only the exact, owned key by its hash", async () => {
    const { client, fetch } = setup([
      { ...ownedKey, key_alias: `${input.alias}-other`, token: "b".repeat(64) },
      ownedKey,
    ]);
    await client.revokeUnboundInstanceKey(input);
    expect(String(fetch.mock.calls[0]![0])).toContain("key_alias=tali-instance-ti-pi");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ keys: [ownedKey.token] });
  });

  it("does not revoke substring matches when the exact alias is absent", async () => {
    const { client, fetch } = setup([{ ...ownedKey, key_alias: `${input.alias}-other` }]);
    await client.revokeUnboundInstanceKey(input);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { ...ownedKey, metadata: { ...ownedKey.metadata, tali_project_id: "tp-other" } },
    { ...ownedKey, metadata: { ...ownedKey.metadata, tali_instance_id: "ti-other" } },
    { ...ownedKey, metadata: { ...ownedKey.metadata, managed_by: "someone-else" } },
    { ...ownedKey, metadata: undefined },
    { ...ownedKey, token: "sk-raw-secret" },
  ])("refuses unverified ownership or token identity: %j", async (key) => {
    const { client, fetch } = setup([key]);
    await expect(client.revokeUnboundInstanceKey(input)).rejects.toThrow("ownership");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses incomplete and ambiguous results", async () => {
    const incomplete = setup([ownedKey], 2);
    await expect(incomplete.client.revokeUnboundInstanceKey(input)).rejects.toThrow("safely");
    expect(incomplete.fetch).toHaveBeenCalledOnce();
    const ambiguous = setup([ownedKey, ownedKey]);
    await expect(ambiguous.client.revokeUnboundInstanceKey(input)).rejects.toThrow("ownership");
    expect(ambiguous.fetch).toHaveBeenCalledOnce();
  });
});
