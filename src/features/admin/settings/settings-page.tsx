"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { pickText } from "@/i18n/locales";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { ENTITY_ICON_KEYS, EntityIcon } from "@/components/app/entity-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "@/i18n/navigation";
import { BRAND_FONTS, type SettingKey, type SettingValue } from "@/server/settings/registry";
import type { BreakType, L, Priority, RoleRow } from "../types";
import { LOOKUPS, useLookups, useText } from "../use-lookups";

type AllSettings = { [K in SettingKey]: SettingValue<K> };
const SETTINGS = "/api/v1/admin/settings";

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
      </span>
    </label>
  );
}

/** Generic form wrapper for one setting group: keeps a local draft and saves it with PUT. */
function SettingForm<K extends SettingKey>({
  k,
  initial,
  branchId = null,
  children,
}: {
  k: K;
  initial: SettingValue<K>;
  /** Save as this branch's own value instead of the organization default. */
  branchId?: string | null;
  children: (v: SettingValue<K>, set: (patch: Partial<SettingValue<K>>) => void) => React.ReactNode;
}) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const save = useApiMutation(
    () => api(`${SETTINGS}/${k}${branchId ? `?branchId=${branchId}` : ""}`, { method: "PUT", body: draft }),
    {
      invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`]],
      success: t("saved"),
      // Branding and language affect the server-rendered shell; refresh it.
      onSuccess: () => router.refresh(),
    },
  );
  return (
    <form
      className="bg-card max-w-3xl space-y-4 rounded-xl border p-4 shadow-sm md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      {children(draft, (patch) => setDraft((d) => ({ ...d, ...patch })))}
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={save.isPending}>
          {tu("save")}
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const t = useTranslations("settings");
  const settings = useApiQuery<AllSettings>(SETTINGS);
  const lookups = useLookups();
  if (settings.isLoading || lookups.isLoading) return <LoadingRows rows={6} />;
  if (settings.isError || !settings.data || !lookups.data) return <ErrorState onRetry={() => settings.refetch()} />;
  const s = settings.data;
  const tabs = [
    "branding",
    "regional",
    "ticketing",
    "reception",
    "wifi",
    "agents",
    "wallboard",
    "reports",
    "alerts",
    "security",
    "privacy",
    "visitorStatus",
    "priorities",
    "breaks",
  ] as const;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="branding">
        <TabsList className="flex h-auto flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="branding" className="mt-4">
          <BrandingForm initial={s.branding} />
        </TabsContent>
        <TabsContent value="regional" className="mt-4">
          <RegionalForm initial={s.regional} />
        </TabsContent>
        <TabsContent value="ticketing" className="mt-4">
          <TicketingForm initial={s.ticketing} />
        </TabsContent>
        <TabsContent value="reception" className="mt-4">
          <ReceptionForm initial={s.reception} />
        </TabsContent>
        <TabsContent value="wifi" className="mt-4">
          <WifiTab defaults={s.wifi} branches={lookups.data.branches} />
        </TabsContent>
        <TabsContent value="agents" className="mt-4">
          <AgentWorkForm initial={s.agentWork} />
        </TabsContent>
        <TabsContent value="wallboard" className="mt-4">
          <WallboardForm initial={s.wallboard} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsForm initial={s.reports} />
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          <AlertsForm initial={s.alerts} />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityForm initial={s.security} roles={lookups.data.roles} />
        </TabsContent>
        <TabsContent value="privacy" className="mt-4">
          <PrivacyForm initial={s.privacy} />
        </TabsContent>
        <TabsContent value="visitorStatus" className="mt-4">
          <VisitorStatusForm initial={s.visitorStatus} />
        </TabsContent>
        <TabsContent value="priorities" className="mt-4">
          <Priorities items={lookups.data.priorities} />
        </TabsContent>
        <TabsContent value="breaks" className="mt-4">
          <Breaks items={lookups.data.breakTypes} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BrandingForm({ initial }: { initial: SettingValue<"branding"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="branding" initial={initial}>
      {(v, set) => (
        <>
          <LocalizedInput
            id="br-name"
            label={t("companyName")}
            value={v.companyName}
            onChange={(companyName) => set({ companyName })}
            required
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("primaryColor")} htmlFor="br-primary">
              <Input
                id="br-primary"
                type="color"
                className="h-9 p-1"
                value={v.primaryColor}
                onChange={(e) => set({ primaryColor: e.target.value })}
              />
            </Field>
            <Field label={t("accentColor")} htmlFor="br-accent">
              <Input
                id="br-accent"
                type="color"
                className="h-9 p-1"
                value={v.accentColor}
                onChange={(e) => set({ accentColor: e.target.value })}
              />
            </Field>
            <Field label={t("font")} htmlFor="br-font">
              <NativeSelect id="br-font" value={v.font} onChange={(e) => set({ font: e.target.value as typeof v.font })}>
                {BRAND_FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t("logoUrl")} htmlFor="br-logo" hint={t("logoHint")}>
            <Input id="br-logo" dir="ltr" value={v.logoUrl ?? ""} onChange={(e) => set({ logoUrl: e.target.value || null })} />
          </Field>
          <LocalizedInput
            id="br-welcome"
            label={t("welcomeText")}
            value={v.welcomeText}
            onChange={(welcomeText) => set({ welcomeText })}
          />
          <LocalizedInput
            id="br-footer"
            label={t("ticketFooter")}
            value={v.ticketFooter}
            onChange={(ticketFooter) => set({ ticketFooter })}
          />
        </>
      )}
    </SettingForm>
  );
}

function DigitsSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: "latn" | "arab";
  onChange: (v: "latn" | "arab") => void;
}) {
  const t = useTranslations("settings");
  return (
    <Field label={label} htmlFor={id}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as "latn" | "arab")}>
        <option value="latn">{t("digitsLatn")}</option>
        <option value="arab">{t("digitsArab")}</option>
      </NativeSelect>
    </Field>
  );
}

function RegionalForm({ initial }: { initial: SettingValue<"regional"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="regional" initial={initial}>
      {(v, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <DigitsSelect
              id="rg-ds"
              label={t("digitsScreen")}
              value={v.digitsScreen}
              onChange={(digitsScreen) => set({ digitsScreen })}
            />
            <DigitsSelect
              id="rg-dt"
              label={t("digitsTicket")}
              value={v.digitsTicket}
              onChange={(digitsTicket) => set({ digitsTicket })}
            />
            <DigitsSelect
              id="rg-dv"
              label={t("digitsVoice")}
              value={v.digitsVoice}
              onChange={(digitsVoice) => set({ digitsVoice })}
            />
            <Field label={t("timeFormat")} htmlFor="rg-tf">
              <NativeSelect
                id="rg-tf"
                value={v.timeFormat}
                onChange={(e) => set({ timeFormat: e.target.value as "12h" | "24h" })}
              >
                <option value="12h">{t("time12")}</option>
                <option value="24h">{t("time24")}</option>
              </NativeSelect>
            </Field>
          </div>
          <Check label={t("showHijri")} checked={v.showHijri} onChange={(showHijri) => set({ showHijri })} />
        </>
      )}
    </SettingForm>
  );
}

function TicketingForm({ initial }: { initial: SettingValue<"ticketing"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="ticketing" initial={initial}>
      {(v, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("numberPad")} htmlFor="tk-pad" hint={t("numberPadHint")}>
              <Input
                id="tk-pad"
                type="number"
                min={0}
                max={6}
                value={v.numberPad}
                onChange={(e) => set({ numberPad: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("separator")} htmlFor="tk-sep">
              <Input
                id="tk-sep"
                maxLength={3}
                dir="ltr"
                value={v.separator}
                onChange={(e) => set({ separator: e.target.value })}
              />
            </Field>
            <Field label={t("dailyResetTime")} htmlFor="tk-reset" hint={t("dailyResetHint")}>
              <Input
                id="tk-reset"
                type="time"
                dir="ltr"
                value={v.dailyResetTime}
                onChange={(e) => set({ dailyResetTime: e.target.value })}
              />
            </Field>
          </div>
          <Check label={t("showQrOnTicket")} checked={v.showQrOnTicket} onChange={(showQrOnTicket) => set({ showQrOnTicket })} />
        </>
      )}
    </SettingForm>
  );
}

function ReceptionForm({ initial }: { initial: SettingValue<"reception"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="reception" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("receptionIntro")}</p>
          <Check
            label={t("oneTapIssue")}
            hint={t("oneTapIssueHint")}
            checked={v.oneTapIssue}
            onChange={(oneTapIssue) => set({ oneTapIssue })}
          />
          <Check
            label={t("autoPrintDefault")}
            hint={t("autoPrintDefaultHint")}
            checked={v.autoPrint}
            onChange={(autoPrint) => set({ autoPrint })}
          />
          <Check
            label={t("askPriority")}
            hint={t("askPriorityHint")}
            checked={v.askPriority}
            onChange={(askPriority) => set({ askPriority })}
          />
          <Check
            label={t("askLanguage")}
            hint={t("askLanguageHint")}
            checked={v.askLanguage}
            onChange={(askLanguage) => set({ askLanguage })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("afterIssue")} htmlFor="rc-after">
              <NativeSelect
                id="rc-after"
                value={v.afterIssue}
                onChange={(e) => set({ afterIssue: e.target.value as typeof v.afterIssue })}
              >
                <option value="print">{t("afterIssuePrint")}</option>
                <option value="dialog">{t("afterIssueDialog")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("defaultLanguage")} htmlFor="rc-lang">
              <NativeSelect
                id="rc-lang"
                value={v.defaultLanguage}
                onChange={(e) => set({ defaultLanguage: e.target.value as typeof v.defaultLanguage })}
              >
                <option value="interface">{t("languageInterface")}</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </NativeSelect>
            </Field>
          </div>
          <p className="text-muted-foreground text-sm">{t("receptionDataHint")}</p>
        </>
      )}
    </SettingForm>
  );
}

function NumField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function ReportsForm({ initial }: { initial: SettingValue<"reports"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="reports" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("reportsIntro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField
              id="rp-slm"
              label={t("serviceLevelMinutes")}
              hint={t("serviceLevelMinutesHint")}
              value={v.serviceLevelMinutes}
              min={1}
              max={120}
              onChange={(serviceLevelMinutes) => set({ serviceLevelMinutes })}
            />
            <NumField
              id="rp-slp"
              label={t("serviceLevelTargetPct")}
              hint={t("serviceLevelTargetPctHint")}
              value={v.serviceLevelTargetPct}
              min={1}
              max={100}
              onChange={(serviceLevelTargetPct) => set({ serviceLevelTargetPct })}
            />
            <NumField
              id="rp-util"
              label={t("targetUtilisationPct")}
              hint={t("targetUtilisationPctHint")}
              value={v.targetUtilisationPct}
              min={30}
              max={100}
              onChange={(targetUtilisationPct) => set({ targetUtilisationPct })}
            />
            <NumField
              id="rp-hist"
              label={t("forecastHistoryDays")}
              hint={t("forecastHistoryDaysHint")}
              value={v.forecastHistoryDays}
              min={7}
              max={90}
              onChange={(forecastHistoryDays) => set({ forecastHistoryDays })}
            />
          </div>
        </>
      )}
    </SettingForm>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One email per line. Invalid lines block the form's native submit and are listed under the box. */
function EmailsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("settings");
  const [text, setText] = useState(value.join("\n"));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText((cur) => (parse(cur).join("\n") === value.join("\n") ? cur : value.join("\n"))), [value]);
  const bad = parse(text).filter((e) => !EMAIL_RE.test(e));
  const tooMany = parse(text).length > 20;
  useEffect(() => {
    ref.current?.setCustomValidity(bad.length || tooMany ? t("notifyEmailsInvalid") : "");
  }, [bad.length, tooMany, t]);
  return (
    <Field label={t("notifyEmails")} htmlFor="al-emails" hint={t("notifyEmailsHint")}>
      <textarea
        id="al-emails"
        ref={ref}
        dir="ltr"
        rows={4}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
      />
      {(bad.length > 0 || tooMany) && (
        <p className="text-destructive mt-1 text-xs" role="alert">
          {t("notifyEmailsInvalid")}
          {bad.length > 0 && <span dir="ltr"> {bad.join(", ")}</span>}
        </p>
      )}
    </Field>
  );
}
const parse = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function AlertsForm({ initial }: { initial: SettingValue<"alerts"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="alerts" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("alertsIntro")}</p>
          <Check
            label={t("alertsEnabled")}
            hint={t("alertsEnabledHint")}
            checked={v.enabled}
            onChange={(enabled) => set({ enabled })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField
              id="al-long"
              label={t("longWaitMinutes")}
              hint={t("longWaitMinutesHint")}
              value={v.longWaitMinutes}
              min={1}
              max={240}
              onChange={(longWaitMinutes) => set({ longWaitMinutes })}
            />
            <NumField
              id="al-limit"
              label={t("queueLimit")}
              hint={t("queueLimitHint")}
              value={v.queueLimit}
              min={1}
              max={500}
              onChange={(queueLimit) => set({ queueLimit })}
            />
            <NumField
              id="al-idle"
              label={t("agentIdleMinutes")}
              hint={t("agentIdleMinutesHint")}
              value={v.agentIdleMinutes}
              min={1}
              max={240}
              onChange={(agentIdleMinutes) => set({ agentIdleMinutes })}
            />
            <NumField
              id="al-ns"
              label={t("noShowCount")}
              hint={t("noShowCountHint")}
              value={v.noShowCount}
              min={1}
              max={50}
              onChange={(noShowCount) => set({ noShowCount })}
            />
            <NumField
              id="al-nsw"
              label={t("noShowWindowMinutes")}
              hint={t("noShowWindowMinutesHint")}
              value={v.noShowWindowMinutes}
              min={5}
              max={240}
              onChange={(noShowWindowMinutes) => set({ noShowWindowMinutes })}
            />
          </div>
          <EmailsField value={v.notifyEmails} onChange={(notifyEmails) => set({ notifyEmails })} />
        </>
      )}
    </SettingForm>
  );
}

/** Free Wi-Fi on the ticket: an organization default, plus an own value per branch (e.g. per city office). */
function WifiTab({ defaults, branches }: { defaults: SettingValue<"wifi">; branches: { id: string; name: L }[] }) {
  const t = useTranslations("settings");
  const text = useText();
  const [branchId, setBranchId] = useState("");
  const scoped = useApiQuery<AllSettings>(branchId ? `${SETTINGS}?branchId=${branchId}` : null);
  const clear = useApiMutation(() => api(`${SETTINGS}/wifi?branchId=${branchId}`, { method: "DELETE" }), {
    invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`]],
    success: t("wifiInherited"),
  });
  const value = branchId ? scoped.data?.wifi : defaults;

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-muted-foreground text-sm">{t("wifiIntro")}</p>
      {branches.length > 0 && (
        <Field label={t("wifiScope")} htmlFor="wf-scope" className="max-w-sm">
          <NativeSelect id="wf-scope" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t("wifiAllBranches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {text(b.name)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {value ? (
        <SettingForm key={branchId} k="wifi" initial={value} branchId={branchId || null}>
          {(v, set) => (
            <>
              <Check
                label={t("wifiEnabled")}
                hint={t("wifiEnabledHint")}
                checked={v.enabled}
                onChange={(enabled) => set({ enabled })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("wifiSsid")} htmlFor="wf-ssid">
                  <Input id="wf-ssid" dir="ltr" maxLength={32} value={v.ssid} onChange={(e) => set({ ssid: e.target.value })} />
                </Field>
                <Field label={t("wifiPassword")} htmlFor="wf-pass" hint={t("wifiPasswordHint")}>
                  <Input
                    id="wf-pass"
                    dir="ltr"
                    maxLength={63}
                    autoComplete="off"
                    value={v.password}
                    onChange={(e) => set({ password: e.target.value })}
                  />
                </Field>
              </div>
              <Check
                label={t("wifiShowQr")}
                hint={t("wifiShowQrHint")}
                checked={v.showQr}
                onChange={(showQr) => set({ showQr })}
              />
              <LocalizedInput id="wf-title" label={t("wifiTitle")} value={v.title} onChange={(title) => set({ title })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <LocalizedInput
                  id="wf-ssid-label"
                  label={t("wifiSsidLabel")}
                  value={v.ssidLabel}
                  onChange={(ssidLabel) => set({ ssidLabel })}
                />
                <LocalizedInput
                  id="wf-pass-label"
                  label={t("wifiPasswordLabel")}
                  value={v.passwordLabel}
                  onChange={(passwordLabel) => set({ passwordLabel })}
                />
              </div>
              {v.enabled && v.ssid && (
                <div className="bg-muted/40 rounded-lg border border-dashed p-3 text-center text-sm">
                  <div className="font-semibold">{pickText(v.title, "ar") || pickText(v.title, "en")}</div>
                  <div>
                    {pickText(v.ssidLabel, "ar")}: <bdi className="font-mono font-bold">{v.ssid}</bdi>
                  </div>
                  {v.password && (
                    <div>
                      {pickText(v.passwordLabel, "ar")}: <bdi className="font-mono font-bold">{v.password}</bdi>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </SettingForm>
      ) : (
        <LoadingRows rows={3} />
      )}
      {branchId && (
        <Button variant="outline" size="sm" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
          {t("wifiUseDefault")}
        </Button>
      )}
    </div>
  );
}

function AgentWorkForm({ initial }: { initial: SettingValue<"agentWork"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="agentWork" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("agentsIntro")}</p>
          <Check
            label={t("multipleVisitors")}
            hint={t("multipleVisitorsHint")}
            checked={v.multipleVisitors}
            onChange={(multipleVisitors) => set({ multipleVisitors })}
          />
          <Field label={t("visitorsPerAgent")} htmlFor="aw-per" hint={t("visitorsPerAgentHint")} className="max-w-48">
            <Input
              id="aw-per"
              type="number"
              min={1}
              max={20}
              disabled={!v.multipleVisitors}
              value={v.visitorsPerAgent}
              onChange={(e) => set({ visitorsPerAgent: Number(e.target.value) })}
            />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

function WallboardForm({ initial }: { initial: SettingValue<"wallboard"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="wallboard" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("wallboardIntro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("wallboardTheme")} htmlFor="wb-theme">
              <NativeSelect id="wb-theme" value={v.theme} onChange={(e) => set({ theme: e.target.value as typeof v.theme })}>
                <option value="dark">{t("wallboardThemeDark")}</option>
                <option value="light">{t("wallboardThemeLight")}</option>
                <option value="brand">{t("wallboardThemeBrand")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("wallboardTextScale")} htmlFor="wb-scale" hint={t("wallboardTextScaleHint")}>
              <Input
                id="wb-scale"
                type="number"
                min={80}
                max={160}
                step={5}
                value={v.textScale}
                onChange={(e) => set({ textScale: Number(e.target.value) })}
              />
            </Field>
          </div>
          <LocalizedInput id="wb-title" label={t("wallboardTitle")} value={v.title} onChange={(title) => set({ title })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Check label={t("wallboardShowLogo")} checked={v.showLogo} onChange={(showLogo) => set({ showLogo })} />
            <Check
              label={t("wallboardShowCompanyName")}
              checked={v.showCompanyName}
              onChange={(showCompanyName) => set({ showCompanyName })}
            />
            <Check label={t("wallboardShowBranch")} checked={v.showBranch} onChange={(showBranch) => set({ showBranch })} />
            <Check label={t("wallboardShowClock")} checked={v.showClock} onChange={(showClock) => set({ showClock })} />
          </div>
          <p className="text-muted-foreground text-sm">{t("wallboardBrandHint")}</p>
        </>
      )}
    </SettingForm>
  );
}

function SecurityForm({ initial, roles }: { initial: SettingValue<"security">; roles: RoleRow[] }) {
  const t = useTranslations("settings");
  const text = useText();
  return (
    <SettingForm k="security" initial={initial}>
      {(v, set) => {
        const pp = v.passwordPolicy;
        const setPp = (patch: Partial<typeof pp>) => set({ passwordPolicy: { ...pp, ...patch } });
        return (
          <>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">{t("passwordPolicy")}</legend>
              <Field label={t("minLength")} htmlFor="sc-min" className="max-w-40">
                <Input
                  id="sc-min"
                  type="number"
                  min={8}
                  max={128}
                  value={pp.minLength}
                  onChange={(e) => setPp({ minLength: Number(e.target.value) })}
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Check label={t("requireUpper")} checked={pp.requireUpper} onChange={(requireUpper) => setPp({ requireUpper })} />
                <Check label={t("requireLower")} checked={pp.requireLower} onChange={(requireLower) => setPp({ requireLower })} />
                <Check label={t("requireDigit")} checked={pp.requireDigit} onChange={(requireDigit) => setPp({ requireDigit })} />
                <Check
                  label={t("requireSymbol")}
                  checked={pp.requireSymbol}
                  onChange={(requireSymbol) => setPp({ requireSymbol })}
                />
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("maxFailedLogins")} htmlFor="sc-fail">
                <Input
                  id="sc-fail"
                  type="number"
                  min={3}
                  max={20}
                  value={v.maxFailedLogins}
                  onChange={(e) => set({ maxFailedLogins: Number(e.target.value) })}
                />
              </Field>
              <Field label={t("lockoutMinutes")} htmlFor="sc-lock">
                <Input
                  id="sc-lock"
                  type="number"
                  min={1}
                  max={1440}
                  value={v.lockoutMinutes}
                  onChange={(e) => set({ lockoutMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field label={t("inviteExpiryHours")} htmlFor="sc-inv">
                <Input
                  id="sc-inv"
                  type="number"
                  min={1}
                  max={720}
                  value={v.inviteExpiryHours}
                  onChange={(e) => set({ inviteExpiryHours: Number(e.target.value) })}
                />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t("require2faForRoles")}</legend>
              <div className="flex flex-wrap gap-3">
                {roles.map((r) => (
                  <Check
                    key={r.id}
                    label={text(r.name)}
                    checked={v.require2faForRoles.includes(r.key)}
                    onChange={(on) =>
                      set({
                        require2faForRoles: on
                          ? [...v.require2faForRoles, r.key]
                          : v.require2faForRoles.filter((k) => k !== r.key),
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          </>
        );
      }}
    </SettingForm>
  );
}

function PrivacyForm({ initial }: { initial: SettingValue<"privacy"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="privacy" initial={initial}>
      {(v, set) => (
        <>
          <Field label={t("retentionDays")} htmlFor="pv-ret" hint={t("retentionHint")} className="max-w-60">
            <Input
              id="pv-ret"
              type="number"
              min={0}
              max={3650}
              value={v.retentionDays}
              onChange={(e) => set({ retentionDays: Number(e.target.value) })}
            />
          </Field>
          <LocalizedInput
            id="pv-consent"
            label={t("consentText")}
            multiline
            value={v.consentText}
            onChange={(consentText) => set({ consentText })}
          />
          <Check label={t("requireConsent")} checked={v.requireConsent} onChange={(requireConsent) => set({ requireConsent })} />
        </>
      )}
    </SettingForm>
  );
}

function VisitorStatusForm({ initial }: { initial: SettingValue<"visitorStatus"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="visitorStatus" initial={initial}>
      {(v, set) => (
        <>
          <Check label={t("visitorStatusEnabled")} checked={v.enabled} onChange={(enabled) => set({ enabled })} />
          <Field label={t("notifyTurnsAway")} htmlFor="vs-turns" className="max-w-40">
            <Input
              id="vs-turns"
              type="number"
              min={1}
              max={10}
              value={v.notifyTurnsAway}
              onChange={(e) => set({ notifyTurnsAway: Number(e.target.value) })}
            />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

function Priorities({ items }: { items: Priority[] }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [editing, setEditing] = useState<Priority | "new" | null>(null);
  const [f, setF] = useState({
    key: "",
    name: {} as L,
    weight: 0,
    isLane: false,
    color: "#64748b",
    icon: "" as string,
    sortOrder: 0,
  });
  useEffect(() => {
    if (editing === null) return;
    setF(
      editing === "new"
        ? { key: "", name: {}, weight: 50, isLane: false, color: "#0369a1", icon: "", sortOrder: items.length }
        : { ...editing, icon: editing.icon ?? "" },
    );
  }, [editing, items.length]);
  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { ...f, icon: f.icon || null };
      return editing && editing !== "new"
        ? api(`/api/v1/admin/priority-levels/${editing.id}`, { method: "PUT", body })
        : api("/api/v1/admin/priority-levels", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => setEditing(null) },
  );
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/priority-levels/${id}`, { method: "DELETE" }), {
    invalidate,
  });

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addPriority")}
        </Button>
      </div>
      {items.map((p) => (
        <div key={p.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
          <span className="grid size-9 place-items-center rounded-lg text-white" style={{ backgroundColor: p.color }}>
            <EntityIcon name={p.icon} className="size-4.5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2 font-medium">
              {text(p.name)}
              {p.isLane && <Badge variant="secondary">{t("isLane")}</Badge>}
            </div>
            <div className="text-muted-foreground text-xs">
              <span dir="ltr">{p.key}</span> · {t("priorityWeight")}: <span className="tabular">{p.weight}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(p)}>
            <Pencil aria-hidden />
          </Button>
          {p.key !== "normal" && (
            <ConfirmButton
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              label={tu("archive")}
              title={tu("confirmArchive")}
              description={tu("confirmArchiveBody")}
              onConfirm={() => archive.mutateAsync(p.id)}
            />
          )}
        </div>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("tabs.priorities")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <LocalizedInput id="pr-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("priorityKey")} htmlFor="pr-key">
                <Input
                  id="pr-key"
                  dir="ltr"
                  required
                  pattern="[a-z][a-z0-9_]*"
                  value={f.key}
                  onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })}
                />
              </Field>
              <Field label={t("priorityWeight")} htmlFor="pr-w" hint={t("priorityWeightHint")}>
                <Input
                  id="pr-w"
                  type="number"
                  min={0}
                  max={1000}
                  value={f.weight}
                  onChange={(e) => setF({ ...f, weight: Number(e.target.value) })}
                />
              </Field>
              <Field label={tu("color")} htmlFor="pr-c">
                <Input
                  id="pr-c"
                  type="color"
                  className="h-9 p-1"
                  value={f.color}
                  onChange={(e) => setF({ ...f, color: e.target.value })}
                />
              </Field>
            </div>
            <Check label={t("isLane")} hint={t("isLaneHint")} checked={f.isLane} onChange={(isLane) => setF({ ...f, isLane })} />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tu("icon")}>
              {ENTITY_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.icon === k}
                  aria-label={k}
                  onClick={() => setF({ ...f, icon: k })}
                  className={`grid size-8 place-items-center rounded-md border ${f.icon === k ? "border-brand bg-brand/10 text-brand" : "hover:bg-muted"}`}
                >
                  <EntityIcon name={k} className="size-4" />
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {tu("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Breaks({ items }: { items: BreakType[] }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [editing, setEditing] = useState<BreakType | "new" | null>(null);
  const [f, setF] = useState({ name: {} as L, maxMinutes: "" as string | number, countsAsProductive: false, sortOrder: 0 });
  useEffect(() => {
    if (editing === null) return;
    setF(
      editing === "new"
        ? { name: {}, maxMinutes: 15, countsAsProductive: false, sortOrder: items.length }
        : { ...editing, maxMinutes: editing.maxMinutes ?? "" },
    );
  }, [editing, items.length]);
  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { ...f, maxMinutes: f.maxMinutes === "" ? null : Number(f.maxMinutes) };
      return editing && editing !== "new"
        ? api(`/api/v1/admin/break-types/${editing.id}`, { method: "PUT", body })
        : api("/api/v1/admin/break-types", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => setEditing(null) },
  );
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/break-types/${id}`, { method: "DELETE" }), { invalidate });

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addBreak")}
        </Button>
      </div>
      {items.map((b) => (
        <div key={b.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
          <div className="flex-1">
            <div className="font-medium">{text(b.name)}</div>
            <div className="text-muted-foreground text-xs">
              {b.maxMinutes ? `${t("maxMinutes")}: ${b.maxMinutes}` : "—"}
              {b.countsAsProductive && ` · ${t("productive")}`}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(b)}>
            <Pencil aria-hidden />
          </Button>
          <ConfirmButton
            size="icon-sm"
            variant="ghost"
            icon={<Trash2 aria-hidden />}
            label={tu("archive")}
            title={tu("confirmArchive")}
            description={tu("confirmArchiveBody")}
            onConfirm={() => archive.mutateAsync(b.id)}
          />
        </div>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("tabs.breaks")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <LocalizedInput id="bt-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
            <Field label={t("maxMinutes")} htmlFor="bt-max" className="max-w-40">
              <Input
                id="bt-max"
                type="number"
                min={1}
                max={480}
                value={f.maxMinutes}
                onChange={(e) => setF({ ...f, maxMinutes: e.target.value })}
              />
            </Field>
            <Check
              label={t("productive")}
              checked={f.countsAsProductive}
              onChange={(countsAsProductive) => setF({ ...f, countsAsProductive })}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {tu("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
