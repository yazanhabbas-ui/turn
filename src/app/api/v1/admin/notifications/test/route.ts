import { sendTestMessage, testInput } from "@/server/admin/notifications";
import { route } from "@/server/http/route";

/** Sends a sample message to the administrator's own number or email. */
export const POST = route(
  { permission: "settings.manage", body: testInput, rateLimit: { name: "notify-test", limit: 10, windowMs: 60_000, by: "user" } },
  async ({ actor, body }) => sendTestMessage(actor, body),
);
