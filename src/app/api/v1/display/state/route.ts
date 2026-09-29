import { authenticateDevice, bearerToken } from "@/server/display/device";
import { displayState } from "@/server/display/state";
import { route } from "@/server/http/route";

/** Everything the waiting-room screen renders. Authenticated by the device token, not a user session. */
export const GET = route({ auth: "public" }, async ({ req, ip }) => {
  const display = await authenticateDevice(bearerToken(req.headers.get("authorization")), { ip });
  return displayState(display);
});
