import { and, eq, isNull, ne } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import {
  agentProfiles,
  auditLogs,
  branches,
  cities,
  desks,
  invites,
  queues,
  roles,
  userRoles,
  users,
  visitReasons,
} from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { archiveBranch, branchInput, createBranch, createDesk } from "@/server/admin/branches";
import { acceptInvite, createInvite, describeInvite, revokeInvite } from "@/server/admin/invites";
import { createReason, listReasons, setAssignments, setReasonArchived } from "@/server/admin/reasons";
import { archiveRole, cloneRole, createRole, listRoles, updateRole } from "@/server/admin/roles";
import { updateSetting } from "@/server/admin/settings-admin";
import {
  completePasswordReset,
  createUser,
  issuePasswordReset,
  listUsers,
  setUserActive,
  updateUser,
} from "@/server/admin/users";
import { login } from "@/server/auth/service";
import { validateSessionToken } from "@/server/auth/session";
import { AppError } from "@/server/http/errors";
import { mockOutbox } from "@/server/messaging/providers";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const client = { ip: "127.0.0.1", userAgent: "vitest" };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function roleId(key: string) {
  const [r] = await db().select().from(roles).where(eq(roles.key, key));
  return r.id;
}

describe.runIf(available)("admin core (database)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let branchId: string;

  beforeEach(async () => {
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
  });

  afterAll(async () => {
    await pool().end();
  });

  describe("roles", () => {
    it("creates a custom role from the permission matrix and audits it", async () => {
      const { id } = await createRole(admin, {
        name: { ar: "مشرف مسائي", en: "Evening supervisor" },
        permissions: ["reports.view", "tickets.reassign"],
      });
      const role = (await listRoles(admin)).find((r) => r.id === id)!;
      expect(role.permissions.sort()).toEqual(["reports.view", "tickets.reassign"]);
      expect(role.isSystem).toBe(false);
      const [log] = await db().select().from(auditLogs).where(eq(auditLogs.entityId, id));
      expect(log.action).toBe("role.created");
    });

    it("protects built-in roles and blocks archiving roles in use", async () => {
      await expectCode(updateRole(admin, await roleId("admin"), { name: { ar: "x" }, permissions: [] }), "conflict");
      await expectCode(archiveRole(admin, await roleId("agent")), "conflict");
      await expectCode(archiveRole(admin, await roleId("supervisor")), "conflict"); // has a member
      const clone = await cloneRole(admin, await roleId("agent"), { ar: "موظف متدرب" });
      await archiveRole(admin, clone.id);
      expect((await listRoles(admin)).some((r) => r.id === clone.id)).toBe(false);
    });

    it("prevents privilege escalation", async () => {
      await expectCode(createRole(supervisor, { name: { ar: "x" }, permissions: ["settings.manage"] }), "forbidden");
    });
  });

  describe("users", () => {
    it("creates a user without a password and returns a single-use set-password link", async () => {
      const res = await createUser(admin, {
        email: "Fahad@Dor.Local",
        displayName: { ar: "فهد السبيعي", en: "Fahad Al-Subaie" },
        grants: [{ roleId: await roleId("agent"), branchId, cityId: null }],
        agent: { branchId, maxConcurrent: 2, weight: 3 },
      });
      expect(res.setPasswordLink).toMatch(/\/reset-password\/[a-z0-9]+$/);
      const token = res.setPasswordLink!.split("/").pop()!;
      await expectCode(completePasswordReset(token, "weak", client), "weak_password");
      await completePasswordReset(token, "Riyadh-Office-77", client);
      await expectCode(completePasswordReset(token, "Riyadh-Office-77", client), "not_found");
      const session = await login({ email: "fahad@dor.local", password: "Riyadh-Office-77" }, client);
      expect(session.totpRequired).toBe(false);
      const [p] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, res.id));
      expect(p.weight).toBe(3);
    });

    it("finds users by Arabic or transliterated name", async () => {
      expect((await listUsers(admin, { q: "خالد" })).map((u) => u.email)).toEqual(["khalid@dor.local"]);
      expect((await listUsers(admin, { q: "Mohamed" })).map((u) => u.email)).toEqual(["mohammed@dor.local"]);
      expect((await listUsers(admin, { q: "نوره" })).map((u) => u.email)).toEqual(["noura@dor.local"]);
    });

    it("never removes the last administrator or lets admins deactivate themselves", async () => {
      const me = (await listUsers(admin, { q: "admin@dor.local" }))[0];
      await expectCode(updateUser(admin, me.id, { email: me.email, displayName: me.displayName, grants: [] }), "conflict");
      await expectCode(setUserActive(admin, me.id, false), "conflict");
    });

    it("deactivation signs the user out and blocks login", async () => {
      const khalid = (await listUsers(admin, { q: "khalid" }))[0];
      const s = await login({ email: "khalid@dor.local", password: "Dor@Demo2026" }, client);
      await setUserActive(admin, khalid.id, false);
      expect(await validateSessionToken(s.token)).toBeNull();
      await expectCode(login({ email: "khalid@dor.local", password: "Dor@Demo2026" }, client), "invalid_credentials");
    });

    it("supervisors cannot manage users", async () => {
      await expectCode(createUser(supervisor, { email: "x@x.sa", displayName: { ar: "س" }, grants: [] }), "forbidden");
    });

    it("password reset email goes through the messaging provider", async () => {
      process.env.MESSAGING_MOCK = "true";
      mockOutbox().length = 0;
      const sara = (await listUsers(admin, { q: "sara" }))[0];
      const r = await issuePasswordReset(admin, sara.id, { sendEmail: true });
      expect(mockOutbox()[0]).toMatchObject({ channel: "email", to: "sara@dor.local" });
      expect(mockOutbox()[0].text).toContain(r.link);
      delete process.env.MESSAGING_MOCK;
    });
  });

  describe("invites", () => {
    it("invites an agent by email and link; accepting creates the user, role, branch and agent profile once", async () => {
      process.env.MESSAGING_MOCK = "true";
      mockOutbox().length = 0;
      const inv = await createInvite(admin, {
        email: "new.agent@dor.local",
        displayName: { ar: "ليان" },
        roleId: await roleId("agent"),
        branchId,
        channels: ["email"],
        locale: "ar",
      });
      expect(inv.deliveries).toEqual([{ channel: "email", status: "queued" }]);
      expect(mockOutbox()[0].subject).toContain("مجموعة الأفق للخدمات");
      const token = inv.link.split("/").pop()!;
      expect((await describeInvite(token))?.email).toBe("new.agent@dor.local");

      const accepted = await acceptInvite(token, { displayName: { ar: "ليان العنزي" }, password: "Layan-Strong-2026" }, client);
      expect(await validateSessionToken(accepted.token)).not.toBeNull();
      const grants = await db().select().from(userRoles).where(eq(userRoles.userId, accepted.userId));
      expect(grants).toEqual([expect.objectContaining({ roleId: await roleId("agent"), branchId })]);
      expect(await db().select().from(agentProfiles).where(eq(agentProfiles.userId, accepted.userId))).toHaveLength(1);

      await expectCode(acceptInvite(token, { displayName: { ar: "x" }, password: "Layan-Strong-2026" }, client), "not_found");
      delete process.env.MESSAGING_MOCK;
    });

    it("falls back to a copyable link when no provider is configured, and honours revocation", async () => {
      const inv = await createInvite(admin, {
        phone: "+966500000001",
        roleId: await roleId("receptionist"),
        branchId: null,
        channels: ["whatsapp"],
        locale: "en",
      });
      expect(inv.deliveries).toEqual([{ channel: "whatsapp", status: "not_configured" }]);
      expect(inv.link).toContain("/en/invite/");
      await revokeInvite(admin, inv.id);
      expect(await describeInvite(inv.link.split("/").pop()!)).toBeNull();
    });

    it("rejects expired invites and invites for existing emails", async () => {
      await expectCode(
        createInvite(admin, { email: "khalid@dor.local", roleId: await roleId("agent"), branchId, channels: [], locale: "ar" }),
        "conflict",
      );
      const inv = await createInvite(admin, {
        email: "late@dor.local",
        roleId: await roleId("agent"),
        branchId,
        channels: [],
        locale: "ar",
      });
      await db()
        .update(invites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invites.id, inv.id));
      await expectCode(
        acceptInvite(inv.link.split("/").pop()!, { displayName: { ar: "x" }, password: "Late-Strong-2026" }, client),
        "not_found",
      );
    });
  });

  describe("branches and desks", () => {
    it("creating a branch creates a queue for every active reason", async () => {
      const [{ id: cityId }] = await db().select({ id: cities.id }).from(cities).where(eq(cities.code, "JED"));
      const { id } = await createBranch(admin, {
        cityId,
        code: "JED-02",
        name: { ar: "فرع جدة" },
        timezone: "Asia/Riyadh",
        weekend: [5, 6],
      });
      const active = await db().select().from(visitReasons).where(isNull(visitReasons.archivedAt));
      expect(await db().select().from(queues).where(eq(queues.branchId, id))).toHaveLength(active.length);
      await expectCode(
        createBranch(admin, { cityId, code: "JED-02", name: { ar: "مكرر" }, timezone: "Asia/Riyadh", weekend: [5] }),
        "conflict",
      );
      expect(branchInput.safeParse({ cityId, code: "X", name: { ar: "x" }, timezone: "Mars/Base", weekend: [] }).success).toBe(
        false,
      );
    });

    it("desk numbers are unique per branch but reusable after archiving", async () => {
      await expectCode(createDesk(admin, branchId, { number: "1", name: { ar: "مكرر" }, sortOrder: 0 }), "conflict");
      const [d1] = await db()
        .select()
        .from(desks)
        .where(and(eq(desks.branchId, branchId), eq(desks.number, "1")));
      const { archiveDesk } = await import("@/server/admin/branches");
      await archiveDesk(admin, d1.id);
      await createDesk(admin, branchId, { number: "1", name: { ar: "المكتب ١ الجديد" }, sortOrder: 0 });
    });

    it("the last branch cannot be archived", async () => {
      const others = await db().select({ id: branches.id }).from(branches).where(ne(branches.id, branchId));
      for (const o of others) await archiveBranch(admin, o.id);
      await expectCode(archiveBranch(admin, branchId), "conflict");
    });
  });

  describe("visit reasons", () => {
    const base = {
      code: "renewal",
      name: { ar: "تجديد اشتراك", en: "Subscription renewal" },
      icon: "refresh-cw",
      color: "#0f766e",
      prefix: "ر",
      expectedServiceMinutes: 8,
      slaTargetWaitMinutes: 12,
      intakeFields: [{ key: "phone", required: true }],
      allowAppointments: false,
      isFeatured: false,
      sortOrder: 9,
    };

    it("adds a reason with an Arabic prefix, creates queues, and assigns agents with proficiency", async () => {
      const { id } = await createReason(admin, base);
      // One queue per branch (the demo has a Riyadh and a Jeddah branch).
      expect(await db().select().from(queues).where(eq(queues.reasonId, id))).toHaveLength(2);
      const khalid = (await listUsers(admin, { q: "khalid" }))[0];
      await setAssignments(admin, id, [{ userId: khalid.id, proficiency: 5, isPrimary: true }]);
      const reason = (await listReasons(admin)).find((r) => r.id === id)!;
      expect(reason.assignments).toEqual([expect.objectContaining({ userId: khalid.id, proficiency: 5, isPrimary: true })]);
      await expectCode(
        setAssignments(admin, id, [{ userId: khalid.id, groupId: khalid.id, proficiency: 3, isPrimary: true }] as never),
        "validation",
      );
    });

    it("archives instead of deleting and rejects duplicate codes or shortcuts", async () => {
      await expectCode(createReason(admin, { ...base, code: "general" }), "conflict");
      await expectCode(createReason(admin, { ...base, shortcutKey: "1" }), "conflict");
      const [general] = await db().select().from(visitReasons).where(eq(visitReasons.code, "general"));
      await setReasonArchived(admin, general.id, true);
      expect((await listReasons(admin)).some((r) => r.id === general.id)).toBe(false);
      const [q] = await db().select().from(queues).where(eq(queues.reasonId, general.id));
      expect(q.isActive).toBe(false);
    });
  });

  describe("settings", () => {
    it("validates and audits setting changes", async () => {
      await updateSetting(admin, "privacy", { retentionDays: 30 });
      await expectCode(updateSetting(admin, "nope", {}), "not_found");
      await expect(updateSetting(admin, "privacy", { retentionDays: -1 })).rejects.toThrow();
      await expectCode(updateSetting(supervisor, "privacy", { retentionDays: 5 }), "forbidden");
      const [row] = await db().select().from(auditLogs).where(eq(auditLogs.action, "setting.updated"));
      expect((row.after as { retentionDays: number }).retentionDays).toBe(30);
    });
  });

  it("every seeded user exists exactly once", async () => {
    expect(await db().select().from(users)).toHaveLength(11);
  });
});
