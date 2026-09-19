import { defineHandler } from "nitro";
import { changePasswordInputSchema } from "../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../auth/auth";
import { auth as betterAuth } from "../../../../auth/better-auth";
import { noContentResponse, problemResponse } from "../../../../http/responses";

export default defineHandler(async (event) => {
  let auth;
  try {
    auth = await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const input = changePasswordInputSchema.parse(await event.req.json());
    if (!auth.user.hasPassword) {
      return problemResponse(403, "This account does not have a password credential.");
    }
    await (await betterAuth(event.req)).api.changePassword({
      headers: event.req.headers,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
    });
    return noContentResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password change failed.";
    return problemResponse(400, message);
  }
});
