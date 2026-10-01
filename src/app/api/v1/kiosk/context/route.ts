import { authenticateDevice, bearerToken } from "@/server/display/device";
import { route } from "@/server/http/route";
import { kioskContext } from "@/server/kiosk/service";

/** What the self check-in kiosk renders. Authenticated by the kiosk's device token, not a user session. */
export const GET = route(
  { auth: "public", rateLimit: { name: "kiosk-context", limit: 300, windowMs: 60_000 } },
  async ({ req, ip }) => {
    const device = await authenticateDevice(bearerToken(req.headers.get("authorization")), { ip }, "kiosk");
    return kioskContext(device);
  },
);
