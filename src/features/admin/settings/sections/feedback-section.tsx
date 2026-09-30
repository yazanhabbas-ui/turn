"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field as FormField, LoadingRows, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import type { L } from "../../types";
import { useText } from "../../use-lookups";
import { useSettingsShell } from "../settings-context";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SETTINGS, SettingForm } from "../setting-form";
import type { AllSettings } from "./types";

/** Visitor feedback: an organization default, plus an own value per branch (e.g. a different wording per office). */
export function FeedbackSection({
  defaults,
  branches,
  organization,
}: {
  defaults: SettingValue<"feedback">;
  branches: { id: string; name: L }[];
  organization: boolean;
}) {
  const t = useTranslations("settings");
  const text = useText();
  const shell = useSettingsShell();
  const [branchId, setBranchId] = useState(organization ? "" : (branches[0]?.id ?? ""));
  const scoped = useApiQuery<AllSettings>(branchId ? `${SETTINGS}?branchId=${branchId}` : null);
  const clear = useApiMutation(() => api(`${SETTINGS}/feedback?branchId=${branchId}`, { method: "DELETE" }), {
    invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`]],
    success: t("feedbackInherited"),
  });
  const value = branchId ? scoped.data?.feedback : defaults;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("feedbackIntro")}</p>
      {branches.length > 0 && (
        <SettingCard title={t("cards.feedbackScope")}>
          <FormField label={t("feedbackScope")} htmlFor="fb-scope" className="max-w-sm">
            <NativeSelect id="fb-scope" value={branchId} onChange={(e) => shell.guard(() => setBranchId(e.target.value))}>
              {organization && <option value="">{t("feedbackAllBranches")}</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {text(b.name)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {branchId && (
            <Button
              variant="outline"
              size="sm"
              className="max-lg:h-10"
              disabled={clear.isPending}
              onClick={() => clear.mutate(undefined)}
            >
              {t("feedbackUseDefault")}
            </Button>
          )}
        </SettingCard>
      )}
      {value ? (
        <SettingForm key={branchId} k="feedback" initial={value} branchId={branchId || null}>
          {(v, set) => (
            <>
              <SettingCard title={t("cards.feedbackAsk")} columns={2}>
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
                  <NativeSelect
                    id="fb-style"
                    value={v.style}
                    onChange={(e) => set({ style: e.target.value as "stars" | "faces" })}
                  >
                    <option value="faces">{t("feedbackStyleFaces")}</option>
                    <option value="stars">{t("feedbackStyleStars")}</option>
                  </NativeSelect>
                </FormField>
                <NumField
                  id="fb-low"
                  label={t("feedbackLowScore")}
                  hint={t("feedbackLowScoreHint")}
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
              <SettingCard title={t("cards.feedbackTexts")}>
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
              <p className="text-muted-foreground text-sm">{t("feedbackPrivacyNote")}</p>
            </>
          )}
        </SettingForm>
      ) : (
        <LoadingRows rows={3} />
      )}
    </div>
  );
}
