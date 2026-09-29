/** Realistic Arabic-first demo organization. Used by the seed CLI and as the integration-test fixture. */
import { eq } from "drizzle-orm";
import { normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { EXAMPLE_SUPERVISOR_PERMISSIONS } from "@/domain/rbac/permissions";
import { hashPassword } from "@/server/auth/password";
import { putSetting } from "@/server/settings/service";
import { defaultSetting } from "@/server/settings/registry";
import type { Tx } from "../client";
import * as s from "../schema";
import { syncPermissions } from "./permissions";

/** Demo password for every seeded account. Change it after first login (README → Security). */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "Dor@Demo2026";

type Person = { email: string; ar: string; en: string; role: string; phone?: string };

const PEOPLE: Person[] = [
  { email: "admin@dor.local", ar: "مدير النظام", en: "System Admin", role: "admin" },
  { email: "supervisor@dor.local", ar: "ريم المطيري", en: "Reem Al-Mutairi", role: "supervisor" },
  { email: "reception@dor.local", ar: "هند الزهراني", en: "Hind Al-Zahrani", role: "receptionist" },
  { email: "khalid@dor.local", ar: "خالد العتيبي", en: "Khalid Al-Otaibi", role: "agent" },
  { email: "noura@dor.local", ar: "نورة القحطاني", en: "Noura Al-Qahtani", role: "agent" },
  { email: "mohammed@dor.local", ar: "محمد الشهري", en: "Mohammed Al-Shehri", role: "agent" },
  { email: "sara@dor.local", ar: "سارة الدوسري", en: "Sara Al-Dosari", role: "agent" },
  { email: "abdullah@dor.local", ar: "عبدالله الحربي", en: "Abdullah Al-Harbi", role: "agent" },
];

async function createDemo(tx: Tx, organizationId: string) {
  const [branch] = await tx
    .insert(s.branches)
    .values({
      organizationId,
      code: "RUH-01",
      name: { ar: "الفرع الرئيسي - الرياض", en: "Main Branch - Riyadh" },
      address: { ar: "طريق الملك فهد، الرياض", en: "King Fahd Road, Riyadh" },
      timezone: "Asia/Riyadh",
      weekend: [5, 6],
      isDefault: true,
    })
    .returning();

  const [floor] = await tx
    .insert(s.floors)
    .values({ organizationId, branchId: branch.id, name: { ar: "الطابق الأرضي", en: "Ground floor" } })
    .returning();

  const deskRows = await tx
    .insert(s.desks)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        organizationId,
        branchId: branch.id,
        floorId: floor.id,
        number: String(i + 1),
        name: { ar: `المكتب ${i + 1}`, en: `Desk ${i + 1}` },
        zone: i < 4 ? "A" : "B",
        sortOrder: i,
      })),
    )
    .returning();

  // Roles: built-ins are synced already; add the example custom "Supervisor" role.
  const roleRows = await tx.select().from(s.roles).where(eq(s.roles.organizationId, organizationId));
  const [supervisor] = await tx
    .insert(s.roles)
    .values({
      organizationId,
      key: "supervisor",
      name: { ar: "مشرف", en: "Supervisor" },
      description: { ar: "التقارير وإعادة إسناد التذاكر دون الإعدادات", en: "Reports and ticket reassignment, no settings" },
    })
    .returning();
  await tx
    .insert(s.rolePermissions)
    .values(EXAMPLE_SUPERVISOR_PERMISSIONS.map((permissionKey) => ({ roleId: supervisor.id, permissionKey })));
  const roleByKey = new Map([...roleRows, supervisor].map((r) => [r.key, r]));

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, string>();
  for (const p of PEOPLE) {
    const [u] = await tx
      .insert(s.users)
      .values({
        organizationId,
        email: p.email,
        displayName: { ar: p.ar, en: p.en },
        nameSearch: `${normalizeArabic(p.ar)} ${normalizeArabic(p.en)}`,
        passwordHash,
        passwordChangedAt: new Date(),
        locale: "ar",
      })
      .returning();
    userIds.set(p.email, u.id);
    await tx.insert(s.userRoles).values({ userId: u.id, roleId: roleByKey.get(p.role)!.id, branchId: null });
  }

  const agents = PEOPLE.filter((p) => p.role === "agent");
  await tx.insert(s.agentProfiles).values(
    agents.map((a, i) => ({
      userId: userIds.get(a.email)!,
      organizationId,
      branchId: branch.id,
      defaultDeskId: deskRows[i].id,
      weight: i === 0 ? 2 : 1,
    })),
  );

  const [customerService, corporate] = await tx
    .insert(s.agentGroups)
    .values([
      {
        organizationId,
        branchId: branch.id,
        name: { ar: "خدمة العملاء", en: "Customer service" },
        supervisorUserId: userIds.get("supervisor@dor.local"),
      },
      {
        organizationId,
        branchId: branch.id,
        name: { ar: "علاقات الشركات", en: "Corporate relations" },
        supervisorUserId: userIds.get("supervisor@dor.local"),
      },
    ])
    .returning();
  await tx.insert(s.agentGroupMembers).values([
    { groupId: customerService.id, userId: userIds.get("khalid@dor.local")! },
    { groupId: customerService.id, userId: userIds.get("noura@dor.local")! },
    { groupId: customerService.id, userId: userIds.get("mohammed@dor.local")! },
    { groupId: corporate.id, userId: userIds.get("sara@dor.local")! },
    { groupId: corporate.id, userId: userIds.get("abdullah@dor.local")! },
  ]);

  await tx.insert(s.breakTypes).values([
    { organizationId, name: { ar: "صلاة", en: "Prayer" }, maxMinutes: 20, sortOrder: 0 },
    { organizationId, name: { ar: "استراحة غداء", en: "Lunch" }, maxMinutes: 45, sortOrder: 1 },
    { organizationId, name: { ar: "اجتماع", en: "Meeting" }, maxMinutes: 60, sortOrder: 2, countsAsProductive: true },
    { organizationId, name: { ar: "تدريب", en: "Training" }, sortOrder: 3, countsAsProductive: true },
  ]);

  await tx.insert(s.priorityLevels).values([
    { organizationId, key: "normal", name: { ar: "عادي", en: "Normal" }, weight: 0, color: "#64748b", sortOrder: 0 },
    {
      organizationId,
      key: "vip",
      name: { ar: "كبار الشخصيات / ضيف", en: "VIP / Guest" },
      weight: 100,
      isLane: true,
      color: "#b45309",
      icon: "crown",
      sortOrder: 1,
    },
    {
      organizationId,
      key: "elderly",
      name: { ar: "كبار السن", en: "Elderly" },
      weight: 50,
      color: "#0369a1",
      icon: "person-standing",
      sortOrder: 2,
    },
    {
      organizationId,
      key: "disabled",
      name: { ar: "ذوو الإعاقة", en: "People with disabilities" },
      weight: 50,
      color: "#0369a1",
      icon: "accessibility",
      sortOrder: 3,
    },
    {
      organizationId,
      key: "pregnant",
      name: { ar: "الحوامل", en: "Pregnant" },
      weight: 50,
      color: "#be185d",
      icon: "baby",
      sortOrder: 4,
    },
    {
      organizationId,
      key: "ladies",
      name: { ar: "السيدات / العائلات", en: "Ladies / Families" },
      weight: 30,
      color: "#9333ea",
      icon: "users",
      sortOrder: 5,
    },
    {
      organizationId,
      key: "urgent",
      name: { ar: "عاجل", en: "Urgent" },
      weight: 80,
      color: "#dc2626",
      icon: "siren",
      sortOrder: 6,
    },
  ]);

  const [schedule] = await tx
    .insert(s.schedules)
    .values({ organizationId, name: { ar: "الدوام الرسمي", en: "Office hours" } })
    .returning();
  const workdays = [0, 1, 2, 3, 4]; // Sunday–Thursday
  await tx
    .insert(s.scheduleRules)
    .values([
      ...workdays.map((weekday) => ({ scheduleId: schedule.id, kind: "regular", weekday, opensAt: "08:00", closesAt: "16:00" })),
      ...workdays.map((weekday) => ({ scheduleId: schedule.id, kind: "ramadan", weekday, opensAt: "10:00", closesAt: "15:00" })),
    ]);

  const reasons = await tx
    .insert(s.visitReasons)
    .values([
      {
        organizationId,
        code: "general",
        name: { ar: "استفسار عام", en: "General inquiry" },
        icon: "message-circle-question",
        color: "#0f766e",
        prefix: "A",
        expectedServiceMinutes: 5,
        slaTargetWaitMinutes: 10,
        isFeatured: true,
        shortcutKey: "1",
        sortOrder: 0,
      },
      {
        organizationId,
        code: "contract",
        name: { ar: "توقيع عقد", en: "Contract signing" },
        icon: "file-signature",
        color: "#1d4ed8",
        prefix: "B",
        expectedServiceMinutes: 20,
        slaTargetWaitMinutes: 20,
        intakeFields: [
          { key: "name", required: true },
          { key: "phone", required: true },
          { key: "national_id_last4", required: true },
        ],
        isFeatured: true,
        shortcutKey: "2",
        sortOrder: 1,
      },
      {
        organizationId,
        code: "complaint",
        name: { ar: "شكوى", en: "Complaint" },
        icon: "message-square-warning",
        color: "#b91c1c",
        prefix: "C",
        expectedServiceMinutes: 15,
        slaTargetWaitMinutes: 15,
        intakeFields: [
          { key: "phone", required: true },
          { key: "name", required: false },
        ],
        shortcutKey: "3",
        sortOrder: 2,
      },
      {
        organizationId,
        code: "documents",
        name: { ar: "استلام مستندات", en: "Document pickup" },
        icon: "folder-down",
        color: "#7c3aed",
        prefix: "D",
        expectedServiceMinutes: 5,
        slaTargetWaitMinutes: 10,
        intakeFields: [{ key: "national_id_last4", required: true }],
        isFeatured: true,
        shortcutKey: "4",
        sortOrder: 3,
        cutoffMinutes: 15,
      },
      {
        organizationId,
        code: "account_manager",
        name: { ar: "اجتماع مع مدير الحساب", en: "Meeting with account manager" },
        icon: "briefcase-business",
        color: "#b45309",
        prefix: "E",
        defaultPriorityKey: "normal",
        expectedServiceMinutes: 30,
        slaTargetWaitMinutes: 5,
        intakeFields: [
          { key: "company", required: true },
          { key: "name", required: true },
        ],
        allowAppointments: true,
        shortcutKey: "5",
        sortOrder: 4,
      },
    ])
    .returning();
  const reason = Object.fromEntries(reasons.map((r) => [r.code, r]));
  const uid = (email: string) => userIds.get(email)!;

  await tx.insert(s.reasonAssignments).values([
    { reasonId: reason.general.id, groupId: customerService.id, proficiency: 4, isPrimary: true },
    { reasonId: reason.general.id, userId: uid("sara@dor.local"), proficiency: 3, isPrimary: false },
    { reasonId: reason.contract.id, userId: uid("khalid@dor.local"), proficiency: 5, isPrimary: true },
    { reasonId: reason.contract.id, userId: uid("abdullah@dor.local"), proficiency: 4, isPrimary: true },
    { reasonId: reason.contract.id, userId: uid("mohammed@dor.local"), proficiency: 2, isPrimary: false },
    { reasonId: reason.complaint.id, userId: uid("noura@dor.local"), proficiency: 5, isPrimary: true },
    { reasonId: reason.complaint.id, userId: uid("khalid@dor.local"), proficiency: 3, isPrimary: false },
    { reasonId: reason.documents.id, groupId: customerService.id, proficiency: 4, isPrimary: true },
    { reasonId: reason.account_manager.id, groupId: corporate.id, proficiency: 5, isPrimary: true },
  ]);

  await tx.insert(s.queues).values(reasons.map((r) => ({ organizationId, branchId: branch.id, reasonId: r.id })));

  // Default distribution: bank-style pull with priority + aging. Refined by the distribution engine milestone.
  await tx.insert(s.distributionRules).values({ organizationId, scope: "global", config: { mode: "pull" } });

  const voice = (ar: string, en: string) => ({ ar, en });
  await tx.insert(s.messageTemplates).values([
    {
      organizationId,
      channel: "voice",
      event: "ticket_called",
      body: voice("رقم {ticket}، الرجاء التوجه إلى المكتب {desk}", "Number {ticket}, please go to desk {desk}"),
    },
    {
      organizationId,
      channel: "ticket_print",
      event: "ticket_issued",
      body: voice(
        "نرحب بكم\nرقمكم {ticket}\n{reason}\nأمامكم {ahead} · الانتظار المتوقع {wait} دقيقة",
        "Welcome\nYour number {ticket}\n{reason}\n{ahead} ahead · about {wait} min",
      ),
    },
    {
      organizationId,
      channel: "whatsapp",
      event: "ticket_issued",
      body: voice(
        "أهلاً بك، رقمك {ticket} لخدمة {reason}. تابع دورك: {link}",
        "Welcome, your number is {ticket} for {reason}. Track your turn: {link}",
      ),
    },
    {
      organizationId,
      channel: "whatsapp",
      event: "turn_near",
      body: voice("اقترب دورك! أمامك {ahead} فقط. رقمك {ticket}", "Your turn is near! Only {ahead} ahead. Number {ticket}"),
    },
    {
      organizationId,
      channel: "whatsapp",
      event: "ticket_called",
      body: voice("تفضل، رقمك {ticket}، الرجاء التوجه إلى المكتب {desk}", "Please proceed: number {ticket}, desk {desk}"),
    },
    {
      organizationId,
      channel: "sms",
      event: "ticket_called",
      body: voice("رقمك {ticket}: تفضل إلى المكتب {desk}", "Number {ticket}: please go to desk {desk}"),
    },
    {
      organizationId,
      channel: "email",
      event: "invite",
      subject: voice("دعوة للانضمام إلى {company}", "Invitation to join {company}"),
      body: voice(
        "مرحباً {name}،\nتمت دعوتك للانضمام كـ {role}. أنشئ كلمة المرور من الرابط التالي (صالح حتى {expires}):\n{link}",
        "Hello {name},\nYou have been invited to join as {role}. Set your password using this link (valid until {expires}):\n{link}",
      ),
    },
    {
      organizationId,
      channel: "email",
      event: "password_reset",
      subject: voice("إعادة تعيين كلمة المرور", "Reset your password"),
      body: voice(
        "مرحباً {name}،\nلتعيين كلمة مرور جديدة استخدم الرابط التالي (صالح حتى {expires}):\n{link}\nإذا لم تطلب ذلك فتواصل مع مسؤول النظام.",
        "Hello {name},\nUse this link to set a new password (valid until {expires}):\n{link}\nIf you did not expect this, contact your administrator.",
      ),
    },
    {
      organizationId,
      channel: "whatsapp",
      event: "invite",
      body: voice(
        "مرحباً {name}، تمت دعوتك للانضمام إلى {company} كـ {role}. أنشئ كلمة المرور: {link}",
        "Hello {name}, you are invited to join {company} as {role}. Set your password: {link}",
      ),
    },
    {
      organizationId,
      channel: "sms",
      event: "invite",
      body: voice("دعوة للانضمام إلى {company}: {link}", "Invitation to join {company}: {link}"),
    },
  ]);

  await tx.insert(s.announcements).values([
    {
      organizationId,
      branchId: branch.id,
      kind: "ticker",
      body: { ar: "نرحب بكم في فرعنا الرئيسي، يسعدنا خدمتكم", en: "Welcome to our main branch, we are glad to serve you" },
      sortOrder: 0,
    },
    {
      organizationId,
      branchId: branch.id,
      kind: "ticker",
      body: { ar: "يرجى الاحتفاظ بالتذكرة حتى نهاية الخدمة", en: "Please keep your ticket until your service is complete" },
      sortOrder: 1,
    },
  ]);

  await tx.insert(s.displays).values({ organizationId, branchId: branch.id, name: "شاشة صالة الانتظار", layout: "classic" });

  await putSetting(
    organizationId,
    "branding",
    { ...defaultSetting("branding"), companyName: { ar: "مجموعة الأفق للخدمات", en: "Al Ofoq Services Group" } },
    {},
    tx,
  );
}

/** Creates the organization (if missing), syncs permissions and built-in roles, and adds demo data to new orgs. */
export async function seedOrganization(tx: Tx, slug: string): Promise<{ organizationId: string; created: boolean }> {
  let [org] = await tx.select().from(s.organizations).where(eq(s.organizations.slug, slug));
  const created = !org;
  if (!org) {
    [org] = await tx
      .insert(s.organizations)
      .values({
        slug,
        name: { ar: "مجموعة الأفق للخدمات", en: "Al Ofoq Services Group" },
        defaultLocale: "ar",
        locales: ["ar", "en"],
      })
      .returning();
  }
  await syncPermissions(tx, org.id);
  if (created) await createDemo(tx, org.id);
  return { organizationId: org.id, created };
}
