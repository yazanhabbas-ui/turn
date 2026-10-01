"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { DisplayThemeChoice } from "@/domain/branding/surface-theme";
import type { Branch } from "../types";
import { useText } from "../use-lookups";
import { DEFAULT_CONFIG, type Display, type Lang, type Pairing } from "./types";

const DISPLAYS = "/api/v1/admin/displays";
const LANGUAGE_SETS: { id: string; langs: Lang[] }[] = [
  { id: "ar_en", langs: ["ar", "en"] },
  { id: "en_ar", langs: ["en", "ar"] },
  { id: "ar", langs: ["ar"] },
  { id: "en", langs: ["en"] },
];
const THEMES: DisplayThemeChoice[] = ["default", "dark", "light", "brand"];

/** A self check-in kiosk is a paired device like a waiting-room screen: name, branch, languages and look. */
export function KioskDialog({
  branches,
  kiosk,
  open,
  onOpenChange,
  onCreated,
}: {
  branches: Branch[];
  kiosk: Display | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (name: string, p: Pairing) => void;
}) {
  const t = useTranslations("screens");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [langSet, setLangSet] = useState("ar_en");
  const [theme, setTheme] = useState<DisplayThemeChoice>("default");

  useEffect(() => {
    if (!open) return;
    setName(kiosk?.name ?? "");
    setBranchId(kiosk?.branchId ?? branches[0]?.id ?? "");
    setLangSet(LANGUAGE_SETS.find((s) => s.langs.join() === (kiosk?.config.languages ?? ["ar", "en"]).join())?.id ?? "ar_en");
    setTheme(kiosk?.config.theme ?? "default");
  }, [open, kiosk, branches]);

  const save = useApiMutation(
    () => {
      const config = {
        ...DEFAULT_CONFIG,
        ...(kiosk?.config ?? {}),
        languages: LANGUAGE_SETS.find((s) => s.id === langSet)!.langs,
        theme,
      };
      const body = { name: name.trim(), branchId, kind: "kiosk", layout: "classic", config };
      return kiosk ? api(`${DISPLAYS}/${kiosk.id}`, { method: "PUT", body }) : api<Pairing>(DISPLAYS, { body });
    },
    {
      invalidate: [[DISPLAYS]],
      success: tu("saved"),
      onSuccess: (r) => {
        onOpenChange(false);
        if (!kiosk) onCreated(name.trim(), r as Pairing);
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{kiosk ? t("kiosk.edit") : t("kiosk.add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <p className="text-muted-foreground text-sm">{t("kiosk.intro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tu("name")} htmlFor="k-name">
              <Input id="k-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={tu("branch")} htmlFor="k-branch">
              <NativeSelect id="k-branch" required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("kiosk.languages")} htmlFor="k-langs" hint={t("kiosk.languagesHint")}>
              <NativeSelect id="k-langs" value={langSet} onChange={(e) => setLangSet(e.target.value)}>
                {LANGUAGE_SETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(`kiosk.languageSets.${s.id}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("config.theme")} htmlFor="k-theme">
              <NativeSelect id="k-theme" value={theme} onChange={(e) => setTheme(e.target.value as DisplayThemeChoice)}>
                {THEMES.map((th) => (
                  <option key={th} value={th}>
                    {t(`kiosk.themes.${th}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <p className="text-muted-foreground text-xs">{t("kiosk.settingsHint")}</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tu("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
