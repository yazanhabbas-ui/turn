import { runSimulation, simulateInput } from "@/server/admin/distribution";
import { route } from "@/server/http/route";

export const POST = route(
  {
    permission: "distribution.simulate",
    body: simulateInput,
    rateLimit: { name: "simulate", limit: 30, windowMs: 60_000, by: "user" },
  },
  async ({ actor, body }) => runSimulation(actor, body),
);
