"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingKey, SettingValue } from "@/server/settings/registry";
import { ThemePicker } from "../theme-picker";
import type { Branch } from "../types";
import { useText } from "../use-lookups";
import { CALL_LANGUAGES, type CallLanguages } from "@/domain/display/speech";
import { Check } from "./check";
import { DEFAULT_CONFIG, type Display, type DisplayConfig, type Lang, type Layout, type Pairing } from "./types";

const DISPLAYS = "/api/v1/admin/displays";
const SETTINGS = "/api/v1/admin/settings";
type AllSettings = { [K in SettingKey]: SettingValue<K> };
const LAYOUTS: Layout[] = ["classic", "single", "multi"];
const LANGS: Lang[] = ["ar", "en"];

type Form = { name: string; branchId: string; layout: Layout; config: DisplayConfig; zones: string; voiceEnabled: string };

function toForm(d: Display | null, firstBranch: string): Form {
  const config = { ...DEFAULT_CONFIG, ...(d?.config ?? {}), voice: { ...(d?.config.voice ?? {}) } };
  return {
    name: d?.name ?? "",
    branchId: d?.branchId ?? firstBranch,
    layout: d?.layout ?? "classic",
    config,
    zones: config.zones.join(", "),
    voiceEnabled: config.voice.enabled === undefined ? "inherit" : config.voice.enabled ? "on" : "off",
  };
}

export function DisplayDialog({
  branches,
  display,
  open,
  onOpenChange,
  onCreated,
}: {
  branches: Branch[];
  display: Display | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (name: string, p: Pairing) => void;
}) {
  const t = useTranslations("screens");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  // Colours and the default look for the theme previews; without settings rights the previews use built-in values.
  const settings = useApiQuery<AllSettings>(open ? SETTINGS : null);
  const [f, setF] = useState<Form>(() => toForm(null, ""));

  useEffect(() => {
    if (open) setF(toForm(display, branches[0]?.id ?? ""));
  }, [open, display, branches]);

  const setConfig = (patch: Partial<DisplayConfig>) => setF((x) => ({ ...x, config: { ...x.config, ...patch } }));
  const setVoice = (patch: Partial<DisplayConfig["voice"]>) => setConfig({ voice: { ...f.config.voice, ...patch } });

  const save = useApiMutation(
    () => {
      const voice = { ...f.config.voice };
      if (f.voiceEnabled === "inherit") delete voice.enabled;
      else voice.enabled = f.voiceEnabled === "on";
      const config = {
        ...f.config,
        zones: f.zones
          .split(",")
          .map((z) => z.trim())
          .filter(Boolean),
        voice,
      };
      const body = { name: f.name.trim(), branchId: f.branchId, layout: f.layout, config };
      return display ? api(`${DISPLAYS}/${display.id}`, { method: "PUT", body }) : api<Pairing>(DISPLAYS, { body });
    },
    {
      invalidate: [[DISPLAYS]],
      success: tu("saved"),
      onSuccess: (r) => {
        onOpenChange(false);
        if (!display) onCreated(f.name.trim(), r as Pairing);
      },
    },
  );

  const langs = f.config.languages;
  const volume = f.config.voice.volume;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{display ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tu("name")} htmlFor="d-name">
              <Input id="d-name" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={tu("branch")} htmlFor="d-branch">
              <NativeSelect id="d-branch" required value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("layout")}</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {LAYOUTS.map((l) => (
                <label
                  key={l}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${f.layout === l ? "border-brand bg-brand/5" : ""}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="d-layout"
                      className="accent-brand"
                      checked={f.layout === l}
                      onChange={() => setF({ ...f, layout: l })}
                    />
                    {t(`layouts.${l}.name`)}
                  </span>
                  <span className="text-muted-foreground text-xs">{t(`layouts.${l}.description`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ThemePicker
            withDefault
            legend={t("config.theme")}
            value={f.config.theme}
            onChange={(theme) => setConfig({ theme })}
            primary={settings.data?.branding.primaryColor ?? "#0f766e"}
            accent={settings.data?.branding.accentColor ?? "#b45309"}
            defaultTheme={settings.data?.displayTheme.theme ?? "dark"}
          />
          {display && (
            <>
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-semibold">{t("config.content")}</legend>
                <div className="flex flex-wrap gap-4">
                  {LANGS.map((code) => (
                    <Check
                      key={code}
                      label={tu(code === "ar" ? "languageAr" : "languageEn")}
                      checked={langs.includes(code)}
                      onChange={(on) => setConfig({ languages: on ? [...langs, code] : langs.filter((x) => x !== code) })}
                    />
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("config.rotateSeconds")} htmlFor="d-rot">
                    <Input
                      id="d-rot"
                      type="number"
                      min={2}
                      max={120}
                      value={f.config.rotateSeconds}
                      onChange={(e) => setConfig({ rotateSeconds: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={t("config.zones")} htmlFor="d-zones" hint={t("config.zonesHint")}>
                    <Input id="d-zones" value={f.zones} onChange={(e) => setF({ ...f, zones: e.target.value })} />
                  </Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Check
                    label={t("config.showTicker")}
                    checked={f.config.showTicker}
                    onChange={(showTicker) => setConfig({ showTicker })}
                  />
                  <Check
                    label={t("config.showSlides")}
                    checked={f.config.showSlides}
                    onChange={(showSlides) => setConfig({ showSlides })}
                  />
                  <Check
                    label={t("config.showWaiting")}
                    checked={f.config.showWaiting}
                    onChange={(showWaiting) => setConfig({ showWaiting })}
                  />
                  <Check
                    label={t("config.showClock")}
                    checked={f.config.showClock}
                    onChange={(showClock) => setConfig({ showClock })}
                  />
                </div>
              </fieldset>
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-semibold">{t("config.voice")}</legend>
                <p className="text-muted-foreground text-xs">{t("config.voiceHint")}</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t("config.voiceEnabled")} htmlFor="d-ven">
                    <NativeSelect
                      id="d-ven"
                      value={f.voiceEnabled}
                      onChange={(e) => setF({ ...f, voiceEnabled: e.target.value })}
                    >
                      <option value="inherit">{t("config.inherit")}</option>
                      <option value="on">{t("config.on")}</option>
                      <option value="off">{t("config.off")}</option>
                    </NativeSelect>
                  </Field>
                  <Field
                    label={t("config.volume", { value: volume === undefined ? "—" : Math.round(volume * 100) })}
                    htmlFor="d-vol"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        id="d-vol"
                        type="range"
                        min={0}
                        max={100}
                        className="accent-brand w-full"
                        value={Math.round((volume ?? 1) * 100)}
                        onChange={(e) => setVoice({ volume: Number(e.target.value) / 100 })}
                      />
                      {volume !== undefined && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setVoice({ volume: undefined })}>
                          {t("config.inherit")}
                        </Button>
                      )}
                    </div>
                  </Field>
                  <Field label={t("config.rate")} htmlFor="d-rate" hint={t("config.rateHint")}>
                    <Input
                      id="d-rate"
                      type="number"
                      step={0.05}
                      min={0.5}
                      max={1.5}
                      value={f.config.voice.rate ?? ""}
                      onChange={(e) => setVoice({ rate: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("config.callLanguages")} htmlFor="d-cl">
                    <NativeSelect
                      id="d-cl"
                      value={f.config.voice.callLanguages ?? "inherit"}
                      onChange={(e) =>
                        setVoice({ callLanguages: e.target.value === "inherit" ? undefined : (e.target.value as CallLanguages) })
                      }
                    >
                      <option value="inherit">{t("config.inherit")}</option>
                      {CALL_LANGUAGES.map((c) => (
                        <option key={c} value={c}>
                          {t(`voice.callLanguageOptions.${c}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("config.repeat")} htmlFor="d-rep" hint={t("config.repeatHint")}>
                    <Input
                      id="d-rep"
                      type="number"
                      min={1}
                      max={5}
                      value={f.config.voice.repeat ?? ""}
                      onChange={(e) => setVoice({ repeat: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </Field>
                </div>
              </fieldset>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || langs.length === 0}>
              {tu("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
