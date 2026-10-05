"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { CopyField, Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LOCALE_CODES, LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { AgentProfile, Grant, L, Lookups, UserRow } from "../types";
import { LOOKUPS, useText } from "../use-lookups";

const USERS = "/api/v1/admin/users";

type Form = {
  email: string;
  displayName: L;
  phone: string;
  locale: string;
  password: string;
  grants: Grant[];
  agent: AgentProfile | null;
  groupIds: string[];
};

/** Where a new role grant starts: organization-wide for organization admins, else the admin's own city or branch. */
function defaultScope(lookups: Lookups): { branchId: string | null; cityId: string | null } {
  if (lookups.organizationScope) return { branchId: null, cityId: null };
  if (lookups.cities[0]) return { branchId: null, cityId: lookups.cities[0].id };
  return { branchId: lookups.branches[0]?.id ?? null, cityId: null };
}

function toForm(u: UserRow | null, lookups: Lookups): Form {
  return {
    email: u?.email ?? "",
    displayName: u?.displayName ?? {},
    phone: u?.phone ?? "",
    locale: u?.locale ?? "",
    password: "",
    grants: u?.grants ?? [
      { roleId: lookups.roles.find((r) => r.key === "agent")?.id ?? lookups.roles[0]?.id ?? "", ...defaultScope(lookups) },
    ],
    agent: u?.agent ?? null,
    groupIds: u?.groupIds ?? [],
  };
}

export function UserDialog({
  user,
  lookups,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  lookups: Lookups;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("users");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [form, setForm] = useState<Form>(() => toForm(user, lookups));
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [sendEmail, setSendEmail] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm(user, lookups));
      setLink(null);
    }
  }, [open, user, lookups]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const invalidate = [[USERS], [LOOKUPS]];
  // "Works at": a desk or a hall are alternatives; the one not chosen is cleared on save (D62).
  const [worksAt, setWorksAt] = useState<"desk" | "hall">(user?.agent?.defaultHallId ? "hall" : "desk");
  useEffect(() => {
    if (open) setWorksAt(user?.agent?.defaultHallId ? "hall" : "desk");
  }, [open, user]);

  const save = useApiMutation(
    (body: Form) => {
      const payload = {
        email: body.email,
        displayName: body.displayName,
        phone: body.phone || null,
        locale: body.locale || null,
        grants: body.grants.filter((g) => g.roleId).map((g) => ({ ...g, cityId: g.cityId ?? null })),
        agent: body.agent
          ? {
              ...body.agent,
              shiftId: body.agent.shiftId ?? null,
              defaultDeskId: worksAt === "hall" ? null : (body.agent.defaultDeskId ?? null),
              defaultHallId: worksAt === "hall" ? (body.agent.defaultHallId ?? null) : null,
            }
          : null,
        groupIds: body.groupIds,
        ...(user ? {} : { password: body.password || undefined }),
      };
      return user
        ? api(`${USERS}/${user.id}`, { method: "PUT", body: payload })
        : api<{ id: string; setPasswordLink?: string }>(USERS, { body: payload });
    },
    {
      invalidate,
      success: user ? t("updated") : t("created"),
      onSuccess: (r) => {
        const res = r as { setPasswordLink?: string } | undefined;
        if (res?.setPasswordLink) setLink({ label: t("setPasswordLink"), url: res.setPasswordLink });
        else onOpenChange(false);
      },
    },
  );

  const action = useApiMutation(
    (body: { action: string; sendEmail?: boolean; reason?: string; confirm?: boolean }) =>
      api<{ link?: string }>(`${USERS}/${user!.id}/actions`, { body }),
    {
      invalidate,
      success: t("done"),
      onSuccess: (r) => {
        if (r?.link) setLink({ label: t("resetLinkReady"), url: r.link });
      },
    },
  );

  const agentBranch = lookups.branches.find((b) => b.id === form.agent?.branchId);
  const deskOptions = agentBranch?.desks ?? [];
  const hallOptions = agentBranch?.halls ?? [];
  const groups = lookups.groups;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{user ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>

        {link ? (
          <div className="space-y-4">
            <CopyField label={link.label} value={link.url} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <LocalizedInput
              id="u-name"
              label={t("displayName")}
              value={form.displayName}
              onChange={(v) => set("displayName", v)}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("email")} htmlFor="u-email">
                <Input
                  id="u-email"
                  type="email"
                  dir="ltr"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
              <Field label={t("phone")} htmlFor="u-phone">
                <Input id="u-phone" type="tel" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label={t("language")} htmlFor="u-locale">
                <NativeSelect id="u-locale" value={form.locale} onChange={(e) => set("locale", e.target.value)}>
                  <option value="">—</option>
                  {LOCALE_CODES.map((c) => (
                    <option key={c} value={c}>
                      {LOCALES[c].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!user && (
                <Field label={t("password")} htmlFor="u-password" hint={t("passwordHint")}>
                  <Input
                    id="u-password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                </Field>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                <span className="flex items-center gap-1.5">
                  {t("roles")}
                  <InfoTip>{t("rolesHint")}</InfoTip>
                </span>
              </legend>
              {form.grants.map((g, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect
                    aria-label={t("role")}
                    value={g.roleId}
                    onChange={(e) =>
                      set(
                        "grants",
                        form.grants.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)),
                      )
                    }
                  >
                    {lookups.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {text(r.name)}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label={t("scope")}
                    value={g.cityId ? `c:${g.cityId}` : g.branchId ? `b:${g.branchId}` : ""}
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(":");
                      const scope = { branchId: kind === "b" ? id : null, cityId: kind === "c" ? id : null };
                      set(
                        "grants",
                        form.grants.map((x, j) => (j === i ? { ...x, ...scope } : x)),
                      );
                    }}
                  >
                    {(lookups.organizationScope || (!g.branchId && !g.cityId)) && (
                      <option value="">{t("scopeOrganization")}</option>
                    )}
                    {lookups.cities.map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {t("scopeCity", { name: text(c.name) })}
                      </option>
                    ))}
                    {lookups.branches.map((b) => (
                      <option key={b.id} value={`b:${b.id}`}>
                        {t("scopeBranch", { name: text(b.name) })}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tu("remove")}
                    onClick={() =>
                      set(
                        "grants",
                        form.grants.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("grants", [...form.grants, { roleId: lookups.roles[0]?.id ?? "", ...defaultScope(lookups) }])}
              >
                <Plus aria-hidden />
                {t("addRole")}
              </Button>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="accent-brand size-4"
                  checked={!!form.agent}
                  onChange={(e) =>
                    set(
                      "agent",
                      e.target.checked
                        ? {
                            branchId: lookups.branches.find((b) => b.isDefault)?.id ?? lookups.branches[0]?.id ?? "",
                            maxConcurrent: null,
                            weight: 1,
                            defaultDeskId: null,
                            defaultHallId: null,
                            shiftId: null,
                          }
                        : null,
                    )
                  }
                />
                {t("agentSection")}
                <InfoTip>{t("agentHint")}</InfoTip>
              </label>
              {form.agent && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("agentBranch")} htmlFor="a-branch">
                    <NativeSelect
                      id="a-branch"
                      value={form.agent.branchId}
                      onChange={(e) =>
                        set("agent", { ...form.agent!, branchId: e.target.value, defaultDeskId: null, defaultHallId: null })
                      }
                    >
                      {lookups.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {text(b.name)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {(hallOptions.length > 0 || worksAt === "hall") && (
                    <div className="sm:col-span-2" role="group" aria-label={t("worksAt")}>
                      <div className="mb-1 text-sm font-medium">{t("worksAt")}</div>
                      <div className="inline-flex rounded-lg border p-0.5">
                        {(["desk", "hall"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={worksAt === m}
                            onClick={() => setWorksAt(m)}
                            className={cn(
                              "rounded-md px-3 py-1 text-sm",
                              worksAt === m ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {t(m === "desk" ? "worksAtDesk" : "worksAtHall")}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {worksAt === "hall" ? (
                    <Field label={t("defaultHall")} htmlFor="a-hall" hint={t("defaultHallHint")}>
                      <NativeSelect
                        id="a-hall"
                        value={form.agent.defaultHallId ?? ""}
                        onChange={(e) => set("agent", { ...form.agent!, defaultHallId: e.target.value || null })}
                      >
                        <option value="">{t("noHall")}</option>
                        {hallOptions.map((h) => (
                          <option key={h.id} value={h.id}>
                            {text(h.name)} ({h.capacity})
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : (
                    <Field label={t("defaultDesk")} htmlFor="a-desk">
                      <NativeSelect
                        id="a-desk"
                        value={form.agent.defaultDeskId ?? ""}
                        onChange={(e) => set("agent", { ...form.agent!, defaultDeskId: e.target.value || null })}
                      >
                        <option value="">{t("noDesk")}</option>
                        {deskOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {text(d.name)}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  <Field label={t("shift")} htmlFor="a-shift" hint={t("shiftHint")}>
                    <NativeSelect
                      id="a-shift"
                      value={form.agent.shiftId ?? ""}
                      onChange={(e) => set("agent", { ...form.agent!, shiftId: e.target.value || null })}
                    >
                      <option value="">{t("noShift")}</option>
                      {lookups.shifts.map((sh) => (
                        <option key={sh.id} value={sh.id}>
                          {text(sh.name)} ({sh.startsAt}–{sh.endsAt})
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("maxConcurrent")} htmlFor="a-max" hint={t("maxConcurrentHint")}>
                    <Input
                      id="a-max"
                      type="number"
                      min={1}
                      max={20}
                      value={form.agent.maxConcurrent ?? ""}
                      placeholder={t("organizationDefault")}
                      onChange={(e) =>
                        set("agent", { ...form.agent!, maxConcurrent: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={t("weight")} htmlFor="a-weight" hint={t("weightHint")}>
                    <Input
                      id="a-weight"
                      type="number"
                      min={1}
                      max={100}
                      value={form.agent.weight}
                      onChange={(e) => set("agent", { ...form.agent!, weight: Number(e.target.value) })}
                    />
                  </Field>
                  {groups.length > 0 && (
                    <div className="sm:col-span-2">
                      <p className="mb-1.5 text-sm font-medium">{t("groups")}</p>
                      <div className="flex flex-wrap gap-3">
                        {groups.map((g) => (
                          <label key={g.id} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              className="accent-brand size-4"
                              checked={form.groupIds.includes(g.id)}
                              onChange={(e) =>
                                set(
                                  "groupIds",
                                  e.target.checked ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id),
                                )
                              }
                            />
                            {text(g.name)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>

            {user && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <ConfirmButton
                  label={t("resetPassword")}
                  title={t("resetPasswordTitle")}
                  description={t("resetPasswordBody")}
                  onConfirm={() => action.mutateAsync({ action: "reset_password", sendEmail })}
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="accent-brand size-3.5"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                  />
                  {t("sendByEmail")}
                </label>
                {user.totpEnabled && (
                  <ConfirmButton
                    label={t("reset2fa")}
                    title={t("reset2faTitle")}
                    description={t("reset2faBody")}
                    onConfirm={() => action.mutateAsync({ action: "reset_2fa" })}
                  />
                )}
                <ConfirmButton
                  label={t("forceLogout")}
                  title={t("forceLogoutTitle")}
                  onConfirm={() => action.mutateAsync({ action: "force_logout" })}
                />
                {user.isActive ? (
                  <ConfirmButton
                    variant="destructive"
                    label={t("deactivate")}
                    title={t("deactivateTitle")}
                    description={t("deactivateBody")}
                    onConfirm={() => action.mutateAsync({ action: "deactivate" }).then(() => onOpenChange(false))}
                  />
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => action.mutate({ action: "activate" })}>
                    {t("activate")}
                  </Button>
                )}
                {!user.isActive && !user.anonymizedAt && (
                  <ConfirmButton
                    variant="destructive"
                    label={t("anonymize")}
                    title={t("anonymizeTitle")}
                    description={t("anonymizeBody")}
                    onConfirm={() =>
                      action
                        .mutateAsync({
                          action: "anonymize",
                          reason: "Staff account anonymized by an administrator",
                          confirm: true,
                        })
                        .then(() => onOpenChange(false))
                    }
                  />
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {user ? tu("save") : tu("create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
