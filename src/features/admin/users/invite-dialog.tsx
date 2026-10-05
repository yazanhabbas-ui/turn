"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CopyField, Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LOCALE_CODES, LOCALES } from "@/i18n/locales";
import type { L, Lookups } from "../types";
import { useText } from "../use-lookups";

export const INVITES = "/api/v1/admin/invites";
type Channel = "email" | "whatsapp" | "sms";
export type InviteResult = { link: string; deliveries: { channel: Channel; status: "queued" | "not_configured" }[] };

/** Shows the invite link with copy button and what happened on each delivery channel. */
export function InviteResultView({ result }: { result: InviteResult }) {
  const t = useTranslations("invites");
  return (
    <div className="space-y-3">
      <CopyField label={t("linkReady")} value={result.link} />
    </div>
  );
}

export function InviteDialog({
  lookups,
  open,
  onOpenChange,
}: {
  lookups: Lookups;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("invites");
  const tu = useTranslations("ui");
  const tUsers = useTranslations("users");
  const tc = useTranslations("common");
  const text = useText();
  const agentRole = lookups.roles.find((r) => r.key === "agent")?.id ?? lookups.roles[0]?.id ?? "";
  const defaultBranch = lookups.branches.find((b) => b.isDefault)?.id ?? lookups.branches[0]?.id ?? "";
  const [form, setForm] = useState({
    email: "",
    phone: "",
    displayName: {} as L,
    roleId: agentRole,
    branchId: defaultBranch,
    channels: ["email"] as Channel[],
    locale: "ar",
  });
  const [result, setResult] = useState<InviteResult | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setForm({
        email: "",
        phone: "",
        displayName: {},
        roleId: agentRole,
        branchId: defaultBranch,
        channels: ["email"],
        locale: "ar",
      });
    }
  }, [open, agentRole, defaultBranch]);

  const create = useApiMutation(
    () =>
      api<InviteResult>(INVITES, {
        body: {
          email: form.email || undefined,
          phone: form.phone || undefined,
          displayName: form.displayName,
          roleId: form.roleId,
          branchId: form.branchId || null,
          channels: [],
          locale: form.locale,
        },
      }),
    { invalidate: [[INVITES]], onSuccess: (r) => setResult(r) },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>{t("inviteHint")}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <InviteResultView result={result} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{tUsers("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(undefined);
            }}
          >
            <LocalizedInput
              id="i-name"
              label={tUsers("displayName")}
              value={form.displayName}
              onChange={(v) => setForm({ ...form, displayName: v })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tUsers("email")} htmlFor="i-email">
                <Input
                  id="i-email"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label={tUsers("phone")} htmlFor="i-phone">
                <Input
                  id="i-phone"
                  type="tel"
                  dir="ltr"
                  placeholder="+9665…"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label={tUsers("role")} htmlFor="i-role">
                <NativeSelect id="i-role" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                  {lookups.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {text(r.name)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={tu("branch")} htmlFor="i-branch">
                <NativeSelect
                  id="i-branch"
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                >
                  <option value="">{tu("allBranches")}</option>
                  {lookups.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {text(b.name)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("inviteLanguage")} htmlFor="i-locale">
                <NativeSelect id="i-locale" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
                  {LOCALE_CODES.map((c) => (
                    <option key={c} value={c}>
                      {LOCALES[c].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending || (!form.email && !form.phone)}>
                {t("send")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
