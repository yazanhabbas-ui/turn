"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Field } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogEntry, PageGroup } from "@/domain/pagecontent/catalog";
import { isSafeHttpsUrl } from "@/domain/pagecontent/url";
import type { PreviewEnv, SampleReason } from "@/features/pagecontent/preview-sample";
import type { SettingValue } from "@/server/settings/registry";
import type { Reason } from "../../types";
import { useLookups } from "../../use-lookups";
import { PreviewPanel, previewScreenFor } from "../page-content/preview-panel";
import { TextsEditor } from "../page-content/text-editor";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";
import { useSettingsScope } from "../settings-context";
import type { AllSettings } from "./types";

type PageContent = SettingValue<"pageContent">;

/**
 * Admin, Settings, Page content (D66): the wording and layout options of the self check-in kiosk and of the visitor's
 * status page, with a live preview. The scope switcher at the top decides whether the organization, a city or a branch
 * is being edited; only changed texts are stored, the rest follows the built-in wording.
 */
export function PageContentSection({ initial, all }: { initial: PageContent; all: AllSettings }) {
  const t = useTranslations("settings");
  const [tab, setTab] = useState<PageGroup>("kiosk");
  const env = usePreviewEnv(all);
  return (
    <SettingForm k="pageContent" initial={initial}>
      {(v, set) => (
        <>
          <Tabs value={tab} onValueChange={(value) => setTab(value as PageGroup)}>
            <div className="flex items-center gap-1.5">
              <TabsList>
                <TabsTrigger value="kiosk">{t("pcTabKiosk")}</TabsTrigger>
                <TabsTrigger value="visitor">{t("pcTabVisitor")}</TabsTrigger>
              </TabsList>
              <InfoTip>{t("pcIntro")}</InfoTip>
            </div>
            <TabsContent value="kiosk">
              <KioskTab v={v.kiosk} onChange={(kiosk) => set({ kiosk: { ...v.kiosk, ...kiosk } })} env={env} />
            </TabsContent>
            <TabsContent value="visitor">
              <VisitorTab v={v.visitor} onChange={(visitor) => set({ visitor: { ...v.visitor, ...visitor } })} env={env} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </SettingForm>
  );
}

/** The settings the preview needs, as the pages receive them (effective values of the selected scope + real services). */
function usePreviewEnv(all: AllSettings): PreviewEnv {
  const scope = useSettingsScope();
  const lookups = useLookups();
  const reasons = useApiQuery<{ items: Reason[] }>("/api/v1/admin/reasons");
  const branches = lookups.data?.branches;
  return useMemo(() => {
    const branch =
      (scope.kind === "branch" ? branches?.find((b) => b.id === scope.id) : undefined) ??
      (scope.kind === "city" ? branches?.find((b) => b.cityId === scope.id) : undefined) ??
      branches?.[0];
    const sample: SampleReason[] = (reasons.data?.items ?? [])
      .filter((r) => !r.archivedAt)
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        color: r.color,
        prefix: r.prefix,
        requiresStaff: r.requiresStaff,
        intakeFields: r.intakeFields.map((f) => ({
          key: f.key,
          label: f.label ?? {},
          type: f.type ?? "text",
          required: f.required,
          selfService: f.selfService,
        })),
      }));
    const w = all.waitEstimate;
    const f = all.feedback;
    return {
      branding: {
        companyName: all.branding.companyName,
        logoUrl: all.branding.logoUrl,
        logoDarkUrl: all.branding.logoDarkUrl,
        primaryColor: all.branding.primaryColor,
        accentColor: all.branding.accentColor,
        ticketFooter: all.branding.ticketFooter,
      },
      branchName: branch?.name ?? { ar: "الفرع الرئيسي", en: "Main branch" },
      theme: all.displayTheme.theme,
      kiosk: {
        showWait: all.selfCheckin.showWait,
        showQr: all.selfCheckin.showQr && all.visitorStatus.enabled,
        printTicket: all.selfCheckin.printTicket,
        welcomeText: all.selfCheckin.welcomeText,
      },
      privacy: { consentText: all.privacy.consentText, requireConsent: all.privacy.requireConsent },
      digitsScreen: all.regional.digitsScreen,
      waitDisplay: {
        showOnTicket: w.showOnTicket,
        showAsRange: w.showAsRange,
        minShown: w.minShown,
        label: w.label,
        unitLabel: w.unitLabel,
        nextText: w.nextText,
        disclaimer: w.disclaimer,
      },
      feedback: f.enabled
        ? {
            style: f.style,
            askComment: f.askComment,
            askNps: f.askNps,
            prompt: f.prompt,
            commentPrompt: f.commentPrompt,
            npsPrompt: f.npsPrompt,
            thanks: f.thanks,
            commentMax: 1000,
          }
        : null,
      wifi:
        all.wifi.enabled && all.wifi.ssid
          ? {
              ssid: all.wifi.ssid,
              password: all.wifi.password,
              title: all.wifi.title,
              ssidLabel: all.wifi.ssidLabel,
              passwordLabel: all.wifi.passwordLabel,
            }
          : null,
      reasons: sample,
    };
  }, [all, branches, reasons.data, scope]);
}

/** Editor on the left, preview on the right (below on narrow screens). */
function Layout({ editor, preview }: { editor: React.ReactNode; preview: React.ReactNode }) {
  return (
    <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <div className="min-w-0 space-y-4">{editor}</div>
      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">{preview}</div>
    </div>
  );
}

function KioskTab({
  v,
  onChange,
  env,
}: {
  v: PageContent["kiosk"];
  onChange: (patch: Partial<PageContent["kiosk"]>) => void;
  env: PreviewEnv;
}) {
  const t = useTranslations("settings");
  const [focus, setFocus] = useState<{ id: string; screen: ReturnType<typeof previewScreenFor> } | null>(null);
  const onFocusEntry = (e: CatalogEntry) => setFocus({ id: e.id, screen: previewScreenFor("kiosk", e) });
  return (
    <Layout
      editor={
        <>
          <SettingCard title={t("pcCardKioskOptions")} columns={2}>
            <Check
              id="pc-k-branch"
              label={t("pcShowBranchName")}
              checked={v.showBranchName}
              onChange={(showBranchName) => onChange({ showBranchName })}
            />
            <Check id="pc-k-logo" label={t("pcShowLogo")} checked={v.showLogo} onChange={(showLogo) => onChange({ showLogo })} />
            <Check
              id="pc-k-lang"
              label={t("pcShowLanguageButtons")}
              checked={v.showLanguageButtons}
              onChange={(showLanguageButtons) => onChange({ showLanguageButtons })}
            />
            <Check
              id="pc-k-desc"
              label={t("pcShowReasonDescriptions")}
              checked={v.showReasonDescriptions}
              onChange={(showReasonDescriptions) => onChange({ showReasonDescriptions })}
            />
            <Field label={t("pcHeaderStyle")} htmlFor="pc-k-header">
              <NativeSelect
                id="pc-k-header"
                value={v.headerStyle}
                onChange={(e) => onChange({ headerStyle: e.target.value as "brand" | "plain" })}
              >
                <option value="brand">{t("pcHeaderBrand")}</option>
                <option value="plain">{t("pcHeaderPlain")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("pcSuccessStyle")} htmlFor="pc-k-success" hint={t("pcKioskResultNote")}>
              <NativeSelect
                id="pc-k-success"
                value={v.successStyle}
                onChange={(e) => onChange({ successStyle: e.target.value as "ticket" | "simple" })}
              >
                <option value="ticket">{t("pcSuccessTicket")}</option>
                <option value="simple">{t("pcSuccessSimple")}</option>
              </NativeSelect>
            </Field>
            <NumField
              id="pc-k-tiles"
              label={t("pcTiles")}
              hint={t("pcTilesHint")}
              value={v.tilesPerRowLandscape}
              min={1}
              max={4}
              onChange={(tilesPerRowLandscape) => onChange({ tilesPerRowLandscape })}
            />
          </SettingCard>
          <SettingCard title={t("pcCardTexts")} description={t("pcNoteWelcome")}>
            <TextsEditor group="kiosk" texts={v.texts} onChange={(texts) => onChange({ texts })} onFocusEntry={onFocusEntry} />
          </SettingCard>
        </>
      }
      preview={<PreviewPanel group="kiosk" draft={v} env={env} focus={focus} />}
    />
  );
}

function VisitorTab({
  v,
  onChange,
  env,
}: {
  v: PageContent["visitor"];
  onChange: (patch: Partial<PageContent["visitor"]>) => void;
  env: PreviewEnv;
}) {
  const t = useTranslations("settings");
  const [focus, setFocus] = useState<{ id: string; screen: ReturnType<typeof previewScreenFor> } | null>(null);
  const onFocusEntry = (e: CatalogEntry) => setFocus({ id: e.id, screen: previewScreenFor("visitor", e) });
  const footer = v.footerText;
  const setLink = (i: number, patch: Partial<PageContent["visitor"]["customLinks"][number]>) =>
    onChange({ customLinks: v.customLinks.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  return (
    <Layout
      editor={
        <>
          <SettingCard title={t("pcCardVisitorOptions")} columns={2}>
            <Check
              id="pc-v-branch"
              label={t("pcVShowBranch")}
              checked={v.showBranch}
              onChange={(showBranch) => onChange({ showBranch })}
            />
            <Check id="pc-v-logo" label={t("pcShowLogo")} checked={v.showLogo} onChange={(showLogo) => onChange({ showLogo })} />
            <Check
              id="pc-v-position"
              label={t("pcVShowQueuePosition")}
              checked={v.showQueuePosition}
              onChange={(showQueuePosition) => onChange({ showQueuePosition })}
            />
            <Check
              id="pc-v-wait"
              label={t("pcVShowEstimatedWait")}
              hint={t("pcVShowEstimatedWaitHint")}
              checked={v.showEstimatedWait}
              onChange={(showEstimatedWait) => onChange({ showEstimatedWait })}
            />
            <Check
              id="pc-v-desk"
              label={t("pcVShowDeskCard")}
              checked={v.showDeskCard}
              onChange={(showDeskCard) => onChange({ showDeskCard })}
            />
            <Check
              id="pc-v-wifi"
              label={t("pcVShowWifi")}
              hint={t("pcVShowWifiHint")}
              checked={v.showWifi}
              onChange={(showWifi) => onChange({ showWifi })}
            />
          </SettingCard>
          <SettingCard title={t("pcCardContact")} description={t("pcSupportHint")} columns={2}>
            <Field label={t("pcSupportPhone")} htmlFor="pc-v-phone">
              <Input
                id="pc-v-phone"
                dir="ltr"
                type="tel"
                inputMode="tel"
                maxLength={30}
                value={v.supportPhone}
                onChange={(e) => onChange({ supportPhone: e.target.value })}
              />
            </Field>
            <Field label={t("pcSupportEmail")} htmlFor="pc-v-email">
              <Input
                id="pc-v-email"
                dir="ltr"
                type="email"
                maxLength={120}
                value={v.supportEmail}
                onChange={(e) => onChange({ supportEmail: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">{t("pcFooter")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Textarea
                    id="pc-v-footer-ar"
                    dir="rtl"
                    lang="ar"
                    rows={2}
                    maxLength={300}
                    aria-label={`${t("pcFooter")} (العربية)`}
                    placeholder="العربية"
                    value={footer.ar ?? ""}
                    onChange={(e) => onChange({ footerText: { ...footer, ar: e.target.value } })}
                  />
                  <Textarea
                    id="pc-v-footer-en"
                    dir="ltr"
                    lang="en"
                    rows={2}
                    maxLength={300}
                    aria-label={`${t("pcFooter")} (English)`}
                    placeholder="English"
                    value={footer.en ?? ""}
                    onChange={(e) => onChange({ footerText: { ...footer, en: e.target.value } })}
                  />
                </div>
              </fieldset>
            </div>
          </SettingCard>
          <SettingCard title={t("pcLinks")} description={t("pcLinksHint")}>
            {v.customLinks.map((link, i) => {
              const bad = link.url.trim() !== "" && !isSafeHttpsUrl(link.url.trim());
              return (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      dir="rtl"
                      lang="ar"
                      maxLength={60}
                      aria-label={`${t("pcLinkLabel")} (العربية)`}
                      placeholder={`${t("pcLinkLabel")} (العربية)`}
                      value={link.label.ar ?? ""}
                      onChange={(e) => setLink(i, { label: { ...link.label, ar: e.target.value } })}
                    />
                    <Input
                      dir="ltr"
                      lang="en"
                      maxLength={60}
                      aria-label={`${t("pcLinkLabel")} (English)`}
                      placeholder={`${t("pcLinkLabel")} (English)`}
                      value={link.label.en ?? ""}
                      onChange={(e) => setLink(i, { label: { ...link.label, en: e.target.value } })}
                    />
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Input
                        dir="ltr"
                        type="url"
                        maxLength={500}
                        aria-label={t("pcLinkUrl")}
                        aria-invalid={bad || undefined}
                        placeholder="https://example.com/help"
                        value={link.url}
                        onChange={(e) => setLink(i, { url: e.target.value })}
                      />
                      {bad && <p className="text-destructive text-xs">{t("pcLinkUrlInvalid")}</p>}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("pcLinkRemove")}
                      onClick={() => onChange({ customLinks: v.customLinks.filter((_, k) => k !== i) })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={v.customLinks.length >= 3}
              onClick={() => onChange({ customLinks: [...v.customLinks, { label: {}, url: "" }] })}
            >
              <Plus aria-hidden />
              {t("pcAddLink")}
            </Button>
          </SettingCard>
          <SettingCard title={t("pcCardTexts")} description={t("pcNoteFeedback")}>
            <TextsEditor group="visitor" texts={v.texts} onChange={(texts) => onChange({ texts })} onFocusEntry={onFocusEntry} />
          </SettingCard>
        </>
      }
      preview={<PreviewPanel group="visitor" draft={v} env={env} focus={focus} />}
    />
  );
}
