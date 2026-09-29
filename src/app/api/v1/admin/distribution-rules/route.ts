import { listRules, putRule, ruleInput } from "@/server/admin/distribution";
import { route } from "@/server/http/route";

export const GET = route({ permission: "distribution.manage" }, async ({ actor }) => listRules(actor));

/** Creates or replaces the rule for a scope (global / branch / queue). Takes effect on the next queue decision. */
export const PUT = route({ permission: "distribution.manage", body: ruleInput }, async ({ actor, body }) => putRule(actor, body));
