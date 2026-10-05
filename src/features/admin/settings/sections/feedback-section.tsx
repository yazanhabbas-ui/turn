"use client";

import { useFormatter, useTranslations } from "next-intl";
import { negativeScores } from "@/domain/feedback/negative";
import { Field as FormField, LocalizedInput } from "@/components/admin/form";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

/** Visitor feedback. The level it applies to (organization, city or branch) is picked at the top of the page. */
export function FeedbackSection({ initial }: { initial: SettingValue<"feedback"> }) {
  const t = useTranslations("settings");
  const format = useFormatter();

  return (
    <div className="space-y-4">
      <SettingForm k="feedback" initial={initial}>
        {(v, set) => (
          <>
            <SettingCard title={t("cards.feedbackAsk")} description={t("feedbackIntro")} columns={2}>
              <div className="sm:col-span-2">
                <Check
                  id="fb-enabled"
                  label={t("feedbackEnabled")}
                  hint={t("feedbackEnabledHint")}
                  checked={v.enabled}
                  onChange={(enabled) => set({ enabled })}
                />
              </div>
              <div className="sm:col-span-2">
                <Check
                  id="fb-page"
                  label={t("feedbackOnPage")}
                  hint={t("feedbackOnPageHint")}
                  checked={v.showOnStatusPage}
                  onChange={(showOnStatusPage) => set({ showOnStatusPage })}
                />
              </div>
              <FormField label={t("feedbackStyle")} htmlFor="fb-style">
                <NativeSelect id="fb-style" value={v.style} onChange={(e) => set({ style: e.target.value as "stars" | "faces" })}>
                  <option value="faces">{t("feedbackStyleFaces")}</option>
                  <option value="stars">{t("feedbackStyleStars")}</option>
                </NativeSelect>
              </FormField>
              <NumField
                id="fb-low"
                label={t("feedbackLowScore")}
                hint={`${t("feedbackLowScoreHint")} ${t("feedbackLowScoreExample", {
                  scores: format.list(
                    negativeScores(v.lowScoreThreshold).map((n) => format.number(n)),
                    { type: "unit" },
                  ),
                })}`}
                value={v.lowScoreThreshold}
                min={1}
                max={4}
                onChange={(lowScoreThreshold) => set({ lowScoreThreshold })}
              />
              <Check
                id="fb-comment"
                label={t("feedbackAskComment")}
                checked={v.askComment}
                onChange={(askComment) => set({ askComment })}
              />
              <Check
                id="fb-nps"
                label={t("feedbackAskNps")}
                hint={t("feedbackAskNpsHint")}
                checked={v.askNps}
                onChange={(askNps) => set({ askNps })}
              />
            </SettingCard>
            <SettingCard title={t("cards.feedbackTexts")} description={t("feedbackPrivacyNote")}>
              <LocalizedInput
                id="fb-prompt"
                label={t("feedbackPrompt")}
                value={v.prompt}
                onChange={(prompt) => set({ prompt })}
              />
              <LocalizedInput
                id="fb-comment-prompt"
                label={t("feedbackCommentPrompt")}
                value={v.commentPrompt}
                onChange={(commentPrompt) => set({ commentPrompt })}
              />
              <LocalizedInput
                id="fb-nps-prompt"
                label={t("feedbackNpsPrompt")}
                value={v.npsPrompt}
                onChange={(npsPrompt) => set({ npsPrompt })}
              />
              <LocalizedInput
                id="fb-thanks"
                label={t("feedbackThanks")}
                multiline
                value={v.thanks}
                onChange={(thanks) => set({ thanks })}
              />
            </SettingCard>
          </>
        )}
      </SettingForm>
    </div>
  );
}
