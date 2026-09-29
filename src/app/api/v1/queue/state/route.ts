import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { queueState } from "@/server/queue/views";

export const GET = route({}, async ({ actor, query }) => {
  const branchId = query.get("branchId");
  if (!branchId) throw new AppError("validation", { field: "branchId" });
  return queueState(actor, branchId, { q: query.get("q") ?? undefined });
});
