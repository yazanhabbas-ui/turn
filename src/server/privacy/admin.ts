import { orgOf, requireOrgWide, type Actor } from "../admin/actor";
import { lastRetentionRun, runRetention } from "./retention";

/** Retention is an organization-wide setting, so only organization-wide settings administrators see or run it. */
export async function retentionOverview(actor: Actor) {
  requireOrgWide(actor, "settings.manage");
  return { last: await lastRetentionRun(orgOf(actor)) };
}

/** `dryRun` counts what a run would anonymise or delete now and changes nothing. */
export async function runRetentionNow(actor: Actor, dryRun: boolean) {
  requireOrgWide(actor, "settings.manage");
  const summary = await runRetention(orgOf(actor), {
    dryRun,
    trigger: "manual",
    actorUserId: actor.auth.user.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { summary, last: dryRun ? await lastRetentionRun(orgOf(actor)) : summary };
}
