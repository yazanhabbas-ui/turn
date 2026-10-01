"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorState, Field, LoadingRows, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "@/domain/notifications/policy";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../settings/setting-card";
import { Check, NumField } from "../settings/setting-field";
import { ORGANIZATION_SCOPE, SettingsScopeContext } from "../settings/settings-context";
import { SETTINGS, SettingForm } from "../settings/setting-form";
import { useLookups, useText } from "../use-lookups";

type Value = SettingValue<"notifications">;

/** Organization default, or one branch's own choice of events and channel order. Limits and texts are organization-wide. */
export function EventsTab({ organization }: { organization: boolean }) {
  const t = useTranslations("notifications");
  const text = useText();
  const lookups = useLookups();
  const branches = lookups.data?.branches ?? [];
  const [branchId, setBranchId] = useState("");
  const scope = organization ? branchId : branchId || (branches[0]?.id ?? "");
  const q = useApiQuery<{ notifications: Value }>(`${SETTINGS}${scope ? `?branchId=${scope}` : ""}`);
  const clear = useApiMutation(() => api(`${SETTINGS}/notifications?branchId=${scope}`, { method: "DELETE" }), {
    invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${scope}`]],
    success: t("events.inherited"),
  });

  if (q.isLoading || lookups.isLoading) return <LoadingRows rows={5} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const editable = organization || !!scope;

  return (
    <div className="space-y-4">
      {branches.length > 0 && (
        <SettingCard title={t("events.scopeTitle")}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("events.scope")} htmlFor="nt-scope" className="min-w-56">
              <NativeSelect id="nt-scope" value={scope} onChange={(e) => setBranchId(e.target.value)}>
                {organization && <option value="">{t("events.allBranches")}</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {scope && (
              <Button variant="outline" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
                {t("events.useDefault")}
              </Button>
            )}
          </div>
        </SettingCard>
      )}
      {editable && (
        <SettingsScopeContext.Provider value={scope ? { kind: "branch", id: scope } : ORGANIZATION_SCOPE}>
          <SettingForm key={scope} k="notifications" initial={q.data.notifications}>
            {(v, set) => (
              <>
                {!scope && (
                  <SettingCard title={t("events.generalTitle")}>
                    <Check
                      id="nt-enabled"
                      label={t("events.enabled")}
                      checked={v.enabled}
                      onChange={(enabled) => set({ enabled })}
                    />
                    <Check
                      id="nt-consent"
                      label={t("events.requireConsent")}
                      hint={t("events.requireConsentHint")}
                      checked={v.requireConsent}
                      onChange={(requireConsent) => set({ requireConsent })}
                    />
                  </SettingCard>
                )}
                <SettingCard title={t("events.matrixTitle")} description={t("events.matrixHint")}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-start text-xs">
                          <th className="py-2 pe-3 text-start font-medium">{t("events.event")}</th>
                          <th className="px-3 py-2 text-center font-medium">{t("events.on")}</th>
                          {NOTIFICATION_CHANNELS.map((c) => (
                            <th key={c} className="px-3 py-2 text-center font-medium">
                              {t(`channels.${c}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {NOTIFICATION_EVENTS.map((e) => (
                          <tr key={e} className="border-b last:border-0">
                            <th scope="row" className="py-2.5 pe-3 text-start font-normal">
                              <span className="font-medium">{t(`events.names.${e}`)}</span>
                              <span className="text-muted-foreground block text-xs">{t(`events.hints.${e}`)}</span>
                            </th>
                            <td className="px-3 text-center">
                              <Switch
                                aria-label={`${t(`events.names.${e}`)} — ${t("events.on")}`}
                                checked={v.events[e].enabled}
                                onCheckedChange={(enabled) => set({ events: { ...v.events, [e]: { ...v.events[e], enabled } } })}
                              />
                            </td>
                            {NOTIFICATION_CHANNELS.map((c) => (
                              <td key={c} className="px-3 text-center">
                                <Switch
                                  aria-label={`${t(`events.names.${e}`)} — ${t(`channels.${c}`)}`}
                                  disabled={!v.events[e].enabled}
                                  checked={v.events[e].channels[c]}
                                  onCheckedChange={(on) =>
                                    set({
                                      events: {
                                        ...v.events,
                                        [e]: { ...v.events[e], channels: { ...v.events[e].channels, [c]: on } },
                                      },
                                    })
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SettingCard>
                <SettingCard title={t("events.orderTitle")} description={t("events.orderHint")}>
                  <ol className="space-y-1.5">
                    {v.channelOrder.map((c, i) => (
                      <li key={c} className="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                        <span className="text-muted-foreground w-5 text-center tabular-nums">{i + 1}</span>
                        <span className="flex-1">{t(`channels.${c}`)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === 0}
                          aria-label={t("events.moveUp")}
                          onClick={() => set({ channelOrder: move(v.channelOrder, i, -1) })}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === v.channelOrder.length - 1}
                          aria-label={t("events.moveDown")}
                          onClick={() => set({ channelOrder: move(v.channelOrder, i, 1) })}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                </SettingCard>
                {!scope && (
                  <>
                    <SettingCard title={t("events.limitsTitle")} description={t("events.limitsHint")} columns={3}>
                      <NumField
                        id="nt-max"
                        label={t("events.maxPerTicket")}
                        value={v.limits.maxPerTicket}
                        min={1}
                        max={20}
                        onChange={(maxPerTicket) => set({ limits: { ...v.limits, maxPerTicket } })}
                      />
                      <NumField
                        id="nt-attempts"
                        label={t("events.maxAttempts")}
                        hint={t("events.maxAttemptsHint")}
                        value={v.limits.maxAttempts}
                        min={1}
                        max={10}
                        onChange={(maxAttempts) => set({ limits: { ...v.limits, maxAttempts } })}
                      />
                      <NumField
                        id="nt-retry"
                        label={t("events.retryBase")}
                        hint={t("events.retryBaseHint")}
                        value={v.limits.retryBaseSeconds}
                        min={5}
                        max={3600}
                        onChange={(retryBaseSeconds) => set({ limits: { ...v.limits, retryBaseSeconds } })}
                      />
                      {NOTIFICATION_CHANNELS.map((c) => (
                        <NumField
                          key={c}
                          id={`nt-rate-${c}`}
                          label={t("events.rate", { channel: t(`channels.${c}`) })}
                          value={v.limits.ratePerMinute[c]}
                          min={1}
                          max={6000}
                          onChange={(n) => set({ limits: { ...v.limits, ratePerMinute: { ...v.limits.ratePerMinute, [c]: n } } })}
                        />
                      ))}
                    </SettingCard>
                    <SettingCard title={t("events.footerTitle")} description={t("events.footerHint")}>
                      <LocalizedInput
                        id="nt-footer"
                        label={t("events.footer")}
                        value={v.footer}
                        onChange={(footer) => set({ footer })}
                      />
                    </SettingCard>
                  </>
                )}
              </>
            )}
          </SettingForm>
        </SettingsScopeContext.Provider>
      )}
    </div>
  );
}

function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const out = [...list];
  const j = index + delta;
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}
