import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { publicTicketStatus } from "@/server/queue/views";

/** Visitor's live ticket status (from the QR code). Token-based, no personal data. */
export const GET = route(
  { auth: "public", rateLimit: { name: "ticket-status", limit: 120, windowMs: 60_000 } },
  async ({ params }) => {
    const status = await publicTicketStatus(params.token);
    if (!status) throw new AppError("not_found");
    return status;
  },
);
