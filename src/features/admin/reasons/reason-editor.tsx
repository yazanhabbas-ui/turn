"use client";

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ErrorState, Field, LocalizedInput, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { ENTITY_ICON_KEYS, EntityIcon } from "@/components/app/entity-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentPicker } from "@/components/admin/agent-picker";
import { NativeSelect } from "@/components/ui/native-select";
import { Link, useRouter } from "@/i18n/navigation";
import { fieldSelfService } from "@/domain/kiosk/self-service";
import { cn } from "@/lib/utils";
import type { Assignment, IntakeField, L, Lookups, Reason } from "../types";
import { useAgentOptions } from "../agent-options";
import { LOOKUPS, useLookups, useText } from "../use-lookups";
import { REASONS } from "./reasons-list";

const NO_AGENTS: Lookups["agents"] = [];
const NO_BRANCHES: Lookups["branches"] = [];

const BUILTIN_FIELDS = ["name", "phone", "company", "national_id_last4", "email", "notes"] as const;

type Form = Omit<Reason, "id" | "archivedAt" | "assignments" | "description"> & { description: L };

const EMPTY: Form = {
  code: "",
  name: {},
  description: {},
  icon: "message-circle-question",
  color: "#0f766e",
  prefix: "",
  defaultPriorityKey: "normal",
  expectedServiceMinutes: 10,
  slaTargetWaitMinutes: 15,
  intakeFields: [],
  allowAppointments: false,
  requiresStaff: false,
  isFeatured: false,
  shortcutKey: null,
  sortOrder: 0,
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-xl border p-4 shadow-sm md:p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function ReasonEditor({ id, canManage }: { id: string | null; canManage: boolean }) {
  const t = useTranslations("reasons");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const router = useRouter();
  const reasons = useApiQuery<{ items: Reason[] }>(`${REASONS}?archived=true`);
  const lookups = useLookups();
  const agentOptions = useAgentOptions({
    agents: lookups.data?.agents ?? NO_AGENTS,
    branches: lookups.data?.branches ?? NO_BRANCHES,
  });
  const reason = id ? reasons.data?.items.find((r) => r.id === id) : null;
  const [form, setForm] = useState<Form>(EMPTY);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !reasons.data) return;
    if (reason) {
      const { id: _id, archivedAt: _a, assignments: as, ...rest } = reason;
      void _id;
      void _a;
      setForm({ ...rest, description: rest.description ?? {} });
      setAssignments(
        as.map((a) => ({
          userId: a.userId,
          groupId: a.groupId,
          branchId: a.branchId,
          proficiency: a.proficiency,
          isPrimary: a.isPrimary,
        })),
      );
    } else {
      setForm({ ...EMPTY, sortOrder: reasons.data.items.length });
    }
    setLoaded(true);
  }, [reasons.data, reason, loaded]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const invalidate = [[`${REASONS}?archived=true`], [`${REASONS}?archived=false`], [LOOKUPS]];

  const save = useApiMutation(
    async () => {
      const body = {
        ...form,
        shortcutKey: form.shortcutKey || null,
        defaultPriorityKey: form.defaultPriorityKey || null,
      };
      const targetId = id
        ? (await api(`${REASONS}/${id}`, { method: "PUT", body }), id)
        : (await api<{ id: string }>(REASONS, { body })).id;
      await api(`${REASONS}/${targetId}/assignments`, { method: "PUT", body: assignments });
      return targetId;
    },
    {
      invalidate,
      success: id ? t("saved") : t("created"),
      onSuccess: (newId) => {
        if (!id) router.replace(`/admin/reasons/${newId}`);
      },
    },
  );
  const archive = useApiMutation((archived: boolean) => api(`${REASONS}/${id}`, { method: "PATCH", body: { archived } }), {
    invalidate,
  });

  if (reasons.isLoading || lookups.isLoading || !loaded) return <LoadingRows rows={6} />;
  if (reasons.isError || lookups.isError || !lookups.data) return <ErrorState onRetry={() => reasons.refetch()} />;
  if (id && !reason) return <ErrorState />;

  const fieldOf = (key: string) => form.intakeFields.find((f) => f.key === key);
  const setField = (key: string, value: IntakeField | null) =>
    set(
      "intakeFields",
      value
        ? fieldOf(key)
          ? form.intakeFields.map((f) => (f.key === key ? value : f))
          : [...form.intakeFields, value]
        : form.intakeFields.filter((f) => f.key !== key),
    );
  const customFields = form.intakeFields.filter((f) => !(BUILTIN_FIELDS as readonly string[]).includes(f.key));
  const { agents, groups, branches, priorities } = lookups.data;

  return (
    <form
      className="mx-auto max-w-4xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/admin/reasons" />} aria-label={tc("back")}>
          <ArrowLeft className="rtl-flip" aria-hidden />
        </Button>
        <span className="grid size-10 place-items-center rounded-lg text-white" style={{ backgroundColor: form.color }}>
          <EntityIcon name={form.icon} className="size-5" />
        </span>
        <h1 className="flex-1 text-2xl font-bold">{id ? text(form.name, t("edit")) : t("new")}</h1>
        {id &&
          canManage &&
          (reason?.archivedAt ? (
            <Button type="button" variant="outline" onClick={() => archive.mutate(false)}>
              {tu("restore")}
            </Button>
          ) : (
            <ConfirmButton
              size="default"
              label={tu("archive")}
              title={tu("confirmArchive")}
              description={tu("confirmArchiveBody")}
              onConfirm={() => archive.mutateAsync(true)}
            />
          ))}
        {canManage && (
          <Button type="submit" disabled={save.isPending}>
            {tu("save")}
          </Button>
        )}
      </div>
      {reason?.archivedAt && (
        <Alert>
          <AlertDescription>{t("archivedNotice")}</AlertDescription>
        </Alert>
      )}

      <fieldset disabled={!canManage} className="space-y-5">
        <Section title={t("basics")}>
          <LocalizedInput id="rs-name" label={tu("name")} value={form.name} onChange={(v) => set("name", v)} required />
          <LocalizedInput
            id="rs-desc"
            label={tu("description")}
            value={form.description}
            onChange={(v) => set("description", v)}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("code")} htmlFor="rs-code" hint={t("codeHint")}>
              <Input
                id="rs-code"
                dir="ltr"
                required
                pattern="[a-z0-9_\-]+"
                value={form.code}
                onChange={(e) => set("code", e.target.value.toLowerCase())}
              />
            </Field>
            <Field label={t("prefix")} htmlFor="rs-prefix" hint={t("prefixHint")}>
              <Input
                id="rs-prefix"
                required
                maxLength={3}
                className="text-lg font-bold"
                value={form.prefix}
                onChange={(e) => set("prefix", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={t("defaultPriority")} htmlFor="rs-priority">
              <NativeSelect
                id="rs-priority"
                value={form.defaultPriorityKey ?? ""}
                onChange={(e) => set("defaultPriorityKey", e.target.value)}
              >
                {priorities.map((p) => (
                  <option key={p.id} value={p.key}>
                    {text(p.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={tu("color")} htmlFor="rs-color">
              <Input
                id="rs-color"
                type="color"
                className="h-9 p-1"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
              />
            </Field>
            <Field label={t("shortcut")} htmlFor="rs-shortcut">
              <Input
                id="rs-shortcut"
                maxLength={1}
                dir="ltr"
                className="w-16 text-center"
                value={form.shortcutKey ?? ""}
                onChange={(e) => set("shortcutKey", e.target.value || null)}
              />
            </Field>
            <Field label={tu("sortOrder")} htmlFor="rs-sort">
              <Input
                id="rs-sort"
                type="number"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
              />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{tu("icon")}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tu("icon")}>
              {ENTITY_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.icon === k}
                  aria-label={k}
                  onClick={() => set("icon", k)}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg border",
                    form.icon === k ? "border-brand bg-brand/10 text-brand" : "hover:bg-muted",
                  )}
                >
                  <EntityIcon name={k} className="size-4.5" />
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand mt-0.5 size-4"
              checked={form.isFeatured}
              onChange={(e) => set("isFeatured", e.target.checked)}
            />
            <span>
              <span className="font-medium">{t("featured")}</span>
              <span className="text-muted-foreground block text-xs">{t("featuredHint")}</span>
            </span>
          </label>
        </Section>

        <Section title={t("targets")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("expectedMinutes")} htmlFor="rs-exp">
              <Input
                id="rs-exp"
                type="number"
                min={1}
                max={480}
                required
                value={form.expectedServiceMinutes}
                onChange={(e) => set("expectedServiceMinutes", Number(e.target.value))}
              />
            </Field>
            <Field label={t("slaMinutes")} htmlFor="rs-sla">
              <Input
                id="rs-sla"
                type="number"
                min={1}
                max={480}
                required
                value={form.slaTargetWaitMinutes}
                onChange={(e) => set("slaTargetWaitMinutes", Number(e.target.value))}
              />
            </Field>
          </div>
        </Section>

        <Section title={t("intake")} hint={t("intakeHint")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {BUILTIN_FIELDS.map((key) => {
              const f = fieldOf(key);
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-brand size-4"
                      checked={!!f}
                      onChange={(e) => setField(key, e.target.checked ? { key, required: false } : null)}
                    />
                    {t(`intakeFields.${key}`)}
                  </label>
                  {f && (
                    <div className="flex items-center gap-2">
                      <label className="text-muted-foreground flex items-center gap-1 text-xs" title={t("selfServiceHint")}>
                        <input
                          type="checkbox"
                          className="accent-brand size-3.5"
                          checked={fieldSelfService(f)}
                          onChange={(e) => setField(key, { ...f, selfService: e.target.checked })}
                        />
                        {t("selfService")}
                      </label>
                      <NativeSelect
                        className="h-7 w-28 text-xs"
                        value={f.required ? "1" : "0"}
                        onChange={(e) => setField(key, { ...f, required: e.target.value === "1" })}
                        aria-label={tu("required")}
                      >
                        <option value="0">{tu("optional")}</option>
                        <option value="1">{tu("required")}</option>
                      </NativeSelect>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {customFields.map((f) => (
            <div key={f.key} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[8rem_1fr_7rem_7rem_auto]">
              <Field label={t("customKey")}>
                <Input dir="ltr" value={f.key} readOnly />
              </Field>
              <LocalizedInput
                id={`cf-${f.key}`}
                label={t("customLabel")}
                value={f.label}
                onChange={(label) => setField(f.key, { ...f, label })}
              />
              <Field label={t("fieldType")}>
                <NativeSelect
                  value={f.type ?? "text"}
                  onChange={(e) => setField(f.key, { ...f, type: e.target.value as IntakeField["type"] })}
                >
                  {(["text", "phone", "number", "email"] as const).map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`fieldTypes.${ty}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={tu("required")}>
                <NativeSelect
                  value={f.required ? "1" : "0"}
                  onChange={(e) => setField(f.key, { ...f, required: e.target.value === "1" })}
                >
                  <option value="0">{tu("optional")}</option>
                  <option value="1">{tu("required")}</option>
                </NativeSelect>
              </Field>
              <label
                className="text-muted-foreground flex items-center gap-1 text-xs sm:col-span-full"
                title={t("selfServiceHint")}
              >
                <input
                  type="checkbox"
                  className="accent-brand size-3.5"
                  checked={fieldSelfService(f)}
                  onChange={(e) => setField(f.key, { ...f, selfService: e.target.checked })}
                />
                {t("selfService")}
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={tu("remove")} onClick={() => setField(f.key, null)}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              let n = customFields.length + 1;
              while (fieldOf(`custom_${n}`)) n++;
              setField(`custom_${n}`, { key: `custom_${n}`, label: {}, type: "text", required: false });
            }}
          >
            <Plus aria-hidden />
            {t("addCustomField")}
          </Button>
        </Section>

        <Section title={t("hours")}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={form.allowAppointments}
              onChange={(e) => set("allowAppointments", e.target.checked)}
            />
            {t("allowAppointments")}
          </label>
        </Section>

        <Section title={t("kioskSection")} hint={t("kioskSectionHint")}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={form.requiresStaff}
              onChange={(e) => set("requiresStaff", e.target.checked)}
            />
            {t("requiresStaff")}
          </label>
          <p className="text-muted-foreground text-xs">{t("requiresStaffHint")}</p>
        </Section>

        <Section title={t("assignments")} hint={t("assignmentsHint")}>
          {assignments.length === 0 && (
            <Alert variant="destructive">
              <AlertDescription>{t("noAssignments")}</AlertDescription>
            </Alert>
          )}
          {assignments.map((a, i) => {
            const update = (patch: Partial<Assignment>) =>
              setAssignments(assignments.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_8rem_8rem_auto]">
                <Field label={a.groupId !== undefined && a.groupId !== null ? t("group") : t("agent")}>
                  {a.groupId !== undefined && a.groupId !== null ? (
                    <NativeSelect value={a.groupId} onChange={(e) => update({ groupId: e.target.value })}>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {text(g.name)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <AgentPicker
                      options={agentOptions}
                      value={a.userId ?? ""}
                      onChange={(userId) => update({ userId })}
                      clearable={false}
                      aria-label={t("agent")}
                    />
                  )}
                </Field>
                <Field label={tu("branch")}>
                  <NativeSelect value={a.branchId ?? ""} onChange={(e) => update({ branchId: e.target.value || null })}>
                    <option value="">{tu("allBranches")}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {text(b.name)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t("proficiency")}>
                  <NativeSelect value={a.proficiency} onChange={(e) => update({ proficiency: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={tu("status")}>
                  <NativeSelect value={a.isPrimary ? "1" : "0"} onChange={(e) => update({ isPrimary: e.target.value === "1" })}>
                    <option value="1">{t("primary")}</option>
                    <option value="0">{t("backup")}</option>
                  </NativeSelect>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tu("remove")}
                  onClick={() => setAssignments(assignments.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!agents.length}
              onClick={() =>
                setAssignments([
                  ...assignments,
                  { userId: agents[0]?.id, groupId: null, branchId: null, proficiency: 3, isPrimary: true },
                ])
              }
            >
              <Plus aria-hidden />
              {t("addAgent")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!groups.length}
              onClick={() =>
                setAssignments([
                  ...assignments,
                  { userId: null, groupId: groups[0]?.id, branchId: null, proficiency: 3, isPrimary: true },
                ])
              }
            >
              <Plus aria-hidden />
              {t("addGroup")}
            </Button>
          </div>
        </Section>
      </fieldset>
    </form>
  );
}
