import { authenticateDevice, bearerToken } from "@/server/display/device";
import { route } from "@/server/http/route";
import { kioskIssue, kioskIssueInput } from "@/server/kiosk/service";

/** A visitor takes a ticket at the kiosk. Send an `Idempotency-Key` header so a retry never creates a second ticket. */
export const POST = route(
  { auth: "public", body: kioskIssueInput, rateLimit: { name: "kiosk-tickets-ip", limit: 120, windowMs: 60_000 } },
  async ({ req, ip, body }) => {
    const device = await authenticateDevice(bearerToken(req.headers.get("authorization")), { ip }, "kiosk");
    return kioskIssue(device, {
      ...body,
      idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined,
    });
  },
);
