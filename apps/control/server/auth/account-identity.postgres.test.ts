import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import { prisma } from "../db/prisma";
import { auth, ensureInitialPlatformAdministrator, resetBetterAuthForTests } from "./better-auth";

const databaseUrl = process.env.TALI_AUTH_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("Better Auth account identity on PostgreSQL", () => {
  beforeAll(() => {
    if (new URL(databaseUrl!).pathname !== "/relay_auth_test") {
      throw new Error("Requires the disposable relay_auth_test database.");
    }
    const config = developmentControlConfig();
    config.database.url = databaseUrl!;
    config.server.public_urls = ["http://auth.test"];
    setControlConfigForTests(config);
    resetBetterAuthForTests();
  });
  afterAll(async () => {
    await globalThis.taliPrisma?.$disconnect();
    globalThis.taliPrisma = undefined;
    resetBetterAuthForTests();
    setControlConfigForTests(undefined);
  });

  it("keeps an existing issuer, password hash and cookie login across bootstrap", async () => {
    const password = "existing-admin-password";
    const hash = await hashPassword(password);
    await prisma().authAccount.create({ data: {
      id: "existing-credential", userId: "local-admin", providerId: "credential",
      accountId: "local-admin", issuer: "legacy-credential-issuer", password: hash,
    } });
    await ensureInitialPlatformAdministrator();
    const account = await prisma().authAccount.findUnique({
      where: { providerId_accountId: { providerId: "credential", accountId: "local-admin" } },
    });
    expect(account).toMatchObject({ password: hash, issuer: "legacy-credential-issuer" });
    const instance = await auth(new Request("http://auth.test"));
    const response = await instance.handler(new Request("http://auth.test/api/auth/sign-in/username", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://auth.test" },
      body: JSON.stringify({ username: "admin", password }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
  });

  it("rejects duplicate provider identities even when issuer metadata differs", async () => {
    await expect(prisma().authAccount.create({ data: {
      id: "duplicate-credential", userId: "local-admin", providerId: "credential",
      accountId: "local-admin", issuer: "another-issuer",
    } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same subject in another provider and stores provenance through the library hook", async () => {
    const context = await (await auth(new Request("http://auth.test"))).$context;
    const account = await context.internalAdapter.createAccount({
      providerId: "another-provider", accountId: "local-admin", userId: "local-admin",
    });
    expect(await prisma().authAccount.findUnique({ where: { id: account.id } }))
      .toMatchObject({ providerId: "another-provider", accountId: "local-admin", issuer: "" });
  });
});
