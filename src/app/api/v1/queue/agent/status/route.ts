import { setAgentStatus, statusInput } from "@/server/queue/tickets";
import { route } from "@/server/http/route";

export const POST = route({ permission: "agent.serve", body: statusInput }, async ({ actor, body }) =>
  setAgentStatus(actor, body),
);
