import { describe, expect, it } from "vitest";
import {
  AUDIT_MIN_DAYS,
  AUDIT_SECURITY_MIN_DAYS,
  auditCutoffs,
  cutoff,
  DAY_MS,
  isSecurityAction,
} from "@/domain/privacy/retention";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

const NOW = Date.parse("2026-09-29T07:00:00Z");

describe("retention rules", () => {
  it("0 means keep forever", () => {
    expect(cutoff(NOW, 0)).toBeNull();
    expect(auditCutoffs(NOW, 0)).toBeNull();
    expect(cutoff(NOW, 90)?.getTime()).toBe(NOW - 90 * DAY_MS);
  });

  it("raises the audit period to the minimums", () => {
    const c = auditCutoffs(NOW, 7)!;
    expect(c.general.getTime()).toBe(NOW - AUDIT_MIN_DAYS * DAY_MS);
    expect(c.security.getTime()).toBe(NOW - AUDIT_SECURITY_MIN_DAYS * DAY_MS);
    const long = auditCutoffs(NOW, 1000)!;
    expect(long.general.getTime()).toBe(NOW - 1000 * DAY_MS);
    expect(long.security.getTime()).toBe(NOW - 1000 * DAY_MS);
  });

  it("classifies security-critical audit actions", () => {
    for (const a of ["auth.login", "user.deactivated", "role.updated", "invite.created", "privacy.erasure", "setting.updated"])
      expect(isSecurityAction(a)).toBe(true);
    for (const a of ["branch.updated", "reason.created", "notification.resent"]) expect(isSecurityAction(a)).toBe(false);
  });

  it("has sensible, bounded defaults for every period", () => {
    expect(defaultSetting("privacy")).toMatchObject({
      retentionDays: 365,
      ticketDataDays: 365,
      commentDays: 365,
      notificationDays: 90,
      auditDays: 365,
      credentialDays: 30,
    });
    expect(parseSetting("privacy", { commentDays: -1 }).commentDays).toBe(365);
    expect(parseSetting("privacy", { retentionDays: 0 }).retentionDays).toBe(0);
    expect(parseSetting("privacy", { retentionDays: 30 }).commentDays).toBe(365); // older stored values gain the new fields
  });
});
