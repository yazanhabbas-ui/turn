import { route } from "@/server/http/route";
import { agentWorkspace } from "@/server/queue/views";

/** The signed-in agent's workspace: status, desk, current / reserved / on-hold tickets, queues they serve. */
export const GET = route({ permission: "agent.serve" }, async ({ actor }) => agentWorkspace(actor));
