import QRCode from "qrcode";
import { beginTotpSetup } from "@/server/auth/service";
import { route } from "@/server/http/route";

export const POST = route({ rateLimit: { name: "totp-setup", limit: 10, windowMs: 60_000, by: "user" } }, async ({ auth }) => {
  const { uri, secretBase32 } = await beginTotpSetup(auth);
  // QR is rendered on the server so no third-party QR service is ever contacted.
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return { qrDataUrl, secret: secretBase32 };
});
