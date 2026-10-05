"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import type { CatalogEntry, PageGroup } from "@/domain/pagecontent/catalog";
import type { KioskPageContent, VisitorPageContent } from "@/domain/pagecontent/schema";
import { dirOf } from "@/i18n/locales";
import { PreviewFrame } from "@/features/pagecontent/preview-frame";
import { KioskPreviewScreen, VisitorPreviewScreen } from "@/features/pagecontent/preview-screens";
import {
  KIOSK_SCREENS,
  VISITOR_STATES,
  type KioskScreen,
  type PreviewEnv,
  type VisitorState,
} from "@/features/pagecontent/preview-sample";

type Lang = "ar" | "en";

/** Which preview screen shows a text: the screen the text belongs to (a status text shows its own status). */
export function previewScreenFor(group: PageGroup, entry: CatalogEntry): KioskScreen | VisitorState {
  if (group === "kiosk") {
    if (entry.screen === "messages") return /^(offline|retry|loading)/.test(entry.id) ? "offline" : "unavailable";
    if (entry.screen === "errors") return "form";
    return entry.screen as KioskScreen;
  }
  const id = entry.id;
  if (id.startsWith("stop.")) return "stop";
  if (id.startsWith("feedback.") || id === "finished") return "completed";
  if (id.startsWith("called")) return "called";
  if (id.startsWith("serving")) return "serving";
  if (id === "onHold") return "onHold";
  if (id === "noShow") return "noShow";
  if (id === "cancelled" || id === "notFound") return "cancelled";
  return "waiting";
}

const SIZE = {
  kioskLandscape: { width: 1280, height: 800 },
  kioskPortrait: { width: 800, height: 1280 },
  visitor: { width: 390, height: 820 },
};

/**
 * Live preview next to the editor. It draws the real kiosk screens or the real visitor page, in a frame of the right
 * shape, from the unsaved draft and sample data. Switch language, the screen or state, and (kiosk) the orientation.
 */
export function PreviewPanel({
  group,
  draft,
  env,
  focus,
}: {
  group: PageGroup;
  draft: KioskPageContent | VisitorPageContent;
  env: PreviewEnv;
  /** The text being edited: the preview follows it to the screen where it appears. */
  focus: { id: string; screen: KioskScreen | VisitorState } | null;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [lang, setLang] = useState<Lang>(locale === "en" ? "en" : "ar");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [kioskScreen, setKioskScreen] = useState<KioskScreen>("home");
  const [visitorState, setVisitorState] = useState<VisitorState>("waiting");

  useEffect(() => {
    if (!focus) return;
    if (group === "kiosk") setKioskScreen(focus.screen as KioskScreen);
    else setVisitorState(focus.screen as VisitorState);
  }, [focus, group]);

  const size = group === "visitor" ? SIZE.visitor : orientation === "portrait" ? SIZE.kioskPortrait : SIZE.kioskLandscape;
  const pill = (active: boolean, label: string, onClick: () => void, key?: string) => (
    <Button
      key={key ?? label}
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </Button>
  );

  return (
    <section className="bg-card rounded-xl border shadow-sm" aria-label={t("pcPreview")}>
      <header className="border-b px-4 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t("pcPreview")}
          <InfoTip>{t("pcPreviewHint")}</InfoTip>
        </h3>
      </header>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground me-1 text-xs">{t("pcPreviewLang")}</span>
          {pill(lang === "ar", "العربية", () => setLang("ar"))}
          {pill(lang === "en", "English", () => setLang("en"))}
          {group === "kiosk" && (
            <>
              <span className="bg-border mx-1 h-5 w-px" aria-hidden />
              {pill(orientation === "landscape", t("pcLandscape"), () => setOrientation("landscape"))}
              {pill(orientation === "portrait", t("pcPortrait"), () => setOrientation("portrait"))}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {group === "kiosk"
            ? KIOSK_SCREENS.map((s) => pill(kioskScreen === s, t(`pcScreen_${s}`), () => setKioskScreen(s), s))
            : VISITOR_STATES.map((s) => pill(visitorState === s, t(`pcScreen_${s}`), () => setVisitorState(s), s))}
        </div>
        <PreviewFrame width={size.width} height={size.height} lang={lang} dir={dirOf(lang)} title={t("pcPreview")}>
          {group === "kiosk" ? (
            <KioskPreviewScreen lang={lang} screen={kioskScreen} draft={draft as KioskPageContent} env={env} />
          ) : (
            <VisitorPreviewScreen lang={lang} screen={visitorState} draft={draft as VisitorPageContent} env={env} />
          )}
        </PreviewFrame>
      </div>
    </section>
  );
}
