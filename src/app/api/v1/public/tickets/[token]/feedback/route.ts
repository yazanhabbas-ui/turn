import { feedbackInput, submitFeedback } from "@/server/feedback/service";
import { route } from "@/server/http/route";

/** A visitor rates a completed visit (from the status page or the feedback link). Token-based, no login. */
export const POST = route(
  { auth: "public", body: feedbackInput, rateLimit: { name: "ticket-feedback", limit: 20, windowMs: 60_000 } },
  async ({ params, body }) => submitFeedback(params.token, body),
);
