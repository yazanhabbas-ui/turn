import { z } from "zod";
import { forceLogout, issuePasswordReset, resetTwoFactor, setUserActive } from "@/server/admin/users";
import { route } from "@/server/http/route";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("deactivate") }),
  z.object({ action: z.literal("force_logout") }),
  z.object({ action: z.literal("reset_2fa") }),
  z.object({ action: z.literal("reset_password"), sendEmail: z.boolean().default(false) }),
]);

/** Account actions: activate / deactivate, force logout, reset 2FA, issue a password reset link. */
export const POST = route({ permission: "users.manage", body }, async ({ actor, body, params }) => {
  switch (body.action) {
    case "activate":
    case "deactivate":
      await setUserActive(actor, params.id, body.action === "activate");
      return { ok: true };
    case "force_logout":
      await forceLogout(actor, params.id);
      return { ok: true };
    case "reset_2fa":
      await resetTwoFactor(actor, params.id);
      return { ok: true };
    case "reset_password":
      return issuePasswordReset(actor, params.id, { sendEmail: body.sendEmail });
  }
});
