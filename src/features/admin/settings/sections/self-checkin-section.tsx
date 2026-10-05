"use client";

import { ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { LocalizedInput } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { fieldSelfService, kioskReasonState } from "@/domain/kiosk/self-service";
import type { SettingValue } from "@/server/settings/registry";
import { Link } from "@/i18n/navigation";
import type { Reason } from "../../types";
import { useText } from "../../use-lookups";
import { SettingCard } from "../setting-card";
import { Check, Field, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

/**
 * Self check-in kiosk (D61). The organization default, a city's or a branch's own value is chosen with the scope
 * switcher at the top of the page; the kiosks themselves are created under Admin → Screens.
 */
export function SelfCheckinSection({ initial }: { initial: SettingValue<"selfCheckin"> }) {
  const t = useTranslations("settings");
  const text = useText();
  const reasons = useApiQuery<{ items: Reason[] }>("/api/v1/admin/reasons");
  const list = reasons.data?.items ?? [];
  return (
    <SettingForm k="selfCheckin" initial={initial}>
      {(v, set) => {
        // Empty list = every reason a visitor can take alone; otherwise exactly the chosen ones.
        const available = list.filter((r) => kioskReasonState(r) === "available").map((r) => r.id);
        const effective = new Set(v.allowedReasons.length ? v.allowedReasons : available);
        const toggle = (id: string, on: boolean) => {
          const next = new Set(effective);
          if (on) next.add(id);
          else next.delete(id);
          if (next.size === 0) return;
          const all = available.length === next.size && available.every((x) => next.has(x));
          set({ allowedReasons: all ? [] : [...next] });
        };
        return (
          <>
            <SettingCard title={t("cards.selfCheckin")} description={t("selfCheckinIntro")} columns={2}>
              <Check
                id="sc-enabled"
                label={t("selfCheckinEnabled")}
                hint={t("selfCheckinEnabledHint")}
                checked={v.enabled}
                onChange={(enabled) => set({ enabled })}
              />
              <Check
                id="sc-print"
                label={t("selfCheckinPrint")}
                hint={t("selfCheckinPrintHint")}
                checked={v.printTicket}
                onChange={(printTicket) => set({ printTicket })}
              />
              <Check
                id="sc-wait"
                label={t("selfCheckinShowWait")}
                hint={t("selfCheckinShowWaitHint")}
                checked={v.showWait}
                onChange={(showWait) => set({ showWait })}
              />
              <Check
                id="sc-qr"
                label={t("selfCheckinShowQr")}
                hint={t("selfCheckinShowQrHint")}
                checked={v.showQr}
                onChange={(showQr) => set({ showQr })}
              />
              <NumField
                id="sc-idle"
                label={t("selfCheckinIdle")}
                hint={t("selfCheckinIdleHint")}
                value={v.idleSeconds}
                min={5}
                max={120}
                onChange={(idleSeconds) => set({ idleSeconds })}
              />
            </SettingCard>
            <SettingCard title={t("cards.selfCheckinLimits")} description={t("selfCheckinLimitsHint")} columns={2}>
              <NumField
                id="sc-max"
                label={t("selfCheckinMaxWaiting")}
                hint={t("selfCheckinMaxWaitingHint")}
                value={v.maxWaiting}
                min={0}
                max={2000}
                onChange={(maxWaiting) => set({ maxWaiting })}
              />
              <NumField
                id="sc-rate"
                label={t("selfCheckinRate")}
                hint={t("selfCheckinRateHint")}
                value={v.ratePerMinute}
                min={1}
                max={120}
                onChange={(ratePerMinute) => set({ ratePerMinute })}
              />
            </SettingCard>
            <SettingCard title={t("cards.selfCheckinReasons")} description={t("selfCheckinReasonsHint")}>
              <Field label={t("selfCheckinReasons")} htmlFor="sc-reasons">
                <div id="sc-reasons" className="grid gap-1 sm:grid-cols-2">
                  {list.map((r) => {
                    const staff = kioskReasonState(r) === "ask_staff";
                    return (
                      <div key={r.id} className="flex items-start gap-2 text-sm">
                        <Check
                          label={text(r.name)}
                          hint={staff ? t("selfCheckinNeedsStaff") : undefined}
                          checked={effective.has(r.id)}
                          onChange={(on) => toggle(r.id, on)}
                        />
                      </div>
                    );
                  })}
                </div>
              </Field>
              <p className="text-muted-foreground text-xs">
                {t("selfCheckinReasonsFoot")}{" "}
                <Link href="/admin/reasons" className="text-brand underline">
                  {t("selfCheckinReasonsLink")}
                </Link>
              </p>
              {list.some((r) => r.intakeFields.some((f) => !fieldSelfService(f))) && (
                <p className="text-muted-foreground text-xs">{t("selfCheckinFieldsFoot")}</p>
              )}
            </SettingCard>
            <SettingCard title={t("cards.selfCheckinWelcome")}>
              <LocalizedInput
                id="sc-welcome"
                label={t("selfCheckinWelcome")}
                value={v.welcomeText}
                onChange={(welcomeText) => set({ welcomeText })}
              />
              <p className="text-muted-foreground text-xs">
                {t("selfCheckinWelcomeNote")}{" "}
                <Link href="/admin/settings?section=pageContent" className="text-brand underline">
                  {t("selfCheckinWelcomeLink")}
                </Link>
              </p>
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <ScanLine className="size-4" aria-hidden />
                <Link href="/admin/screens" className="text-brand underline">
                  {t("selfCheckinKiosks")}
                </Link>
              </p>
            </SettingCard>
          </>
        );
      }}
    </SettingForm>
  );
}
