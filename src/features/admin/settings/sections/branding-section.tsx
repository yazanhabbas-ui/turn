"use client";

import { useLocale, useTranslations } from "next-intl";
import { Field, LocalizedInput } from "@/components/admin/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import { BRAND_FONTS, type SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { SettingForm } from "../setting-form";
import { LogoUploader } from "../logo-uploader";

type Branding = SettingValue<"branding">;

/** A mini header and ticket drawn from the draft values, so colour, font and logo changes are visible before saving. */
function BrandPreview({ v }: { v: Branding }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const name = pickText(v.companyName, locale) || "—";
  return (
    <SettingCard title={t("cards.preview")} description={t("cards.previewHint")}>
      <div className="overflow-hidden rounded-lg border" style={{ fontFamily: `${v.font}, sans-serif` }} aria-hidden>
        <div
          className="flex items-center gap-2 border-b-2 bg-white px-3 py-2 text-neutral-900"
          style={{ borderColor: v.primaryColor }}
        >
          {v.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.logoUrl} alt="" className="h-8 w-auto max-w-32 object-contain" />
          ) : (
            <span
              className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: v.primaryColor }}
            >
              {name.slice(0, 1)}
            </span>
          )}
          <span className="truncate font-bold" style={{ color: v.primaryColor }}>
            {name}
          </span>
        </div>
        <div className="grid gap-3 bg-neutral-50 p-4 text-neutral-900 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0 space-y-1 text-sm">
            <div className="font-semibold">{pickText(v.welcomeText, locale) || t("previewSample")}</div>
            <div className="text-xs text-neutral-500">{t("previewSample")}</div>
            <div className="text-xs text-neutral-500">{pickText(v.ticketFooter, locale)}</div>
          </div>
          <div className="rounded-lg border bg-white px-6 py-3 text-center shadow-sm">
            <div className="text-3xl font-black tracking-wide" style={{ color: v.primaryColor }}>
              {t("previewTicketNo")}
            </div>
            <span
              className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: v.accentColor }}
            >
              {v.font}
            </span>
          </div>
        </div>
      </div>
    </SettingCard>
  );
}

export function BrandingSection({ initial }: { initial: Branding }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="branding" initial={initial}>
      {(v, set) => (
        <>
          <BrandPreview v={v} />
          <SettingCard title={t("cards.identity")}>
            <LocalizedInput
              id="br-name"
              label={t("companyName")}
              value={v.companyName}
              onChange={(companyName) => set({ companyName })}
              required
            />
          </SettingCard>
          <SettingCard>
            {/* Logo slot: the uploader saves the logo itself; the form only mirrors the value (and the "use a link" field). */}
            <div id="br-logo">
              <LogoUploader
                value={v.logoUrl}
                onChange={(logoUrl) => set({ logoUrl })}
                onUploaded={(logoUrl) => set({ logoUrl })}
              />
            </div>
          </SettingCard>
          <SettingCard title={t("cards.appearance")} columns={3}>
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
          </SettingCard>
          <SettingCard title={t("cards.texts")}>
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
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
