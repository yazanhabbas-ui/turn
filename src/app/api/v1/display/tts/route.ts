import { NextResponse } from "next/server";
import { authenticateDevice, bearerToken } from "@/server/display/device";
import { speechAudio } from "@/server/display/tts";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";

/**
 * The announcement as one spoken sentence (mp3). Called by waiting-room screens (device token) and by the admin
 * voice test (signed-in staff). Results are cached on the server, so a repeated call is instant.
 */
export const GET = route(
  { auth: "public", rateLimit: { name: "display-tts", limit: 240, windowMs: 60_000 } },
  async ({ req, auth, ip, query }) => {
    if (!auth) await authenticateDevice(bearerToken(req.headers.get("authorization")), { ip });
    const text = query.get("text");
    if (!text) throw new AppError("validation", { field: "text" });
    const audio = await speechAudio(text, query.get("voice") ?? "");
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
    });
  },
);
