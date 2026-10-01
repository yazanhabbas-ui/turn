import { authenticateDevice, bearerToken } from "@/server/display/device";
import { displayState } from "@/server/display/state";
import { route } from "@/server/http/route";

/** Everything the waiting-room screen renders. Authenticated by the device token, not a user session. */
export const GET = route(
  { auth: "public", rateLimit: { name: "display-state", limit: 600, windowMs: 60_000 } },
  async ({ req, ip }) => {
    const display = await authenticateDevice(bearerToken(req.headers.get("authorization")), { ip });
    return displayState(display);
  },
);
