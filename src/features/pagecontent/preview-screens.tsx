"use client";

import { NextIntlClientProvider } from "next-intl";
import { useMemo } from "react";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import type { KioskPageContent, VisitorPageContent } from "@/domain/pagecontent/schema";
import { dirOf, pickText } from "@/i18n/locales";
import { Form, Home, KioskShell, Offline, Result, Unavailable } from "../kiosk/kiosk-screens";
import { StopForm } from "../visitor/stop-form";
import { VisitorStatusView } from "../visitor/visitor-status";
import { makePageT } from "./make-t";
import { PageTextProvider } from "./page-text";
import {
  sampleKioskContext,
  sampleStatus,
  SAMPLE_TICKET,
  type KioskScreen,
  type PreviewEnv,
  type VisitorState,
} from "./preview-sample";

const MESSAGES = { ar: arMessages, en: enMessages };
const noop = () => undefined;

/**
 * The real kiosk screens, fed with the draft and sample data. Nothing is sent or stored: pointer input is off.
 * The live kiosk draws these very components (src/features/kiosk/kiosk-screens.tsx).
 */
export function KioskPreviewScreen({
  lang,
  screen,
  draft,
  env,
}: {
  lang: "ar" | "en";
  screen: KioskScreen;
  draft: KioskPageContent;
  env: PreviewEnv;
}) {
  const ctx = useMemo(() => sampleKioskContext(draft, env), [draft, env]);
  const t = makePageT(MESSAGES[lang].kiosk, lang, draft.texts, { branch: pickText(env.branchName, lang) });
  const reason = ctx.reasons.find((r) => r.intakeFields.length > 0 && r.state === "available") ?? ctx.reasons[0]!;
  const resultReason = ctx.reasons.find((r) => r.state === "available") ?? ctx.reasons[0];
  return (
    <div className="pointer-events-none" aria-hidden>
      <KioskShell lang={lang} theme={ctx.theme} branding={ctx.branding}>
        {screen === "home" && <Home ctx={ctx} lang={lang} languages={["ar", "en"]} t={t} onLang={noop} onPick={noop} />}
        {screen === "form" && (
          <Form ctx={ctx} reason={reason} lang={lang} t={t} busy={false} error={null} onBack={noop} onSubmit={noop} />
        )}
        {screen === "result" && (
          <Result ctx={ctx} result={SAMPLE_TICKET} reason={resultReason} lang={lang} t={t} onDone={noop} onPrint={noop} />
        )}
        {screen === "unavailable" && <Unavailable t={t} ctx={ctx} lang={lang} />}
        {screen === "offline" && <Offline t={t} onRetry={noop} />}
      </KioskShell>
    </div>
  );
}

/** The real visitor page (or the stop-messages page) in a chosen language and state. */
export function VisitorPreviewScreen({
  lang,
  screen,
  draft,
  env,
}: {
  lang: "ar" | "en";
  screen: VisitorState;
  draft: VisitorPageContent;
  env: PreviewEnv;
}) {
  const status = useMemo(() => (screen === "stop" ? null : sampleStatus(screen, lang, draft, env)), [screen, lang, draft, env]);
  return (
    <NextIntlClientProvider locale={lang} messages={MESSAGES[lang]} timeZone="UTC">
      <div dir={dirOf(lang)} lang={lang} className="bg-background text-foreground pointer-events-none min-h-dvh" aria-hidden>
        {status ? (
          <PageTextProvider group="visitor" texts={draft.texts}>
            <VisitorStatusView token="preview" s={status} refetch={noop} updatedAt={0} />
          </PageTextProvider>
        ) : (
          <StopForm token="preview" sig="preview" texts={draft.texts} />
        )}
      </div>
    </NextIntlClientProvider>
  );
}
