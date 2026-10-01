"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Eye, Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { RETENTION_KEYS, type RetentionSummary } from "@/domain/privacy/retention";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

const RETENTION = "/api/v1/admin/privacy/retention";
type Overview = { last: RetentionSummary | null };

/** What a run did (or would do): one line per kind of data. */
function Counts({ summary }: { summary: RetentionSummary }) {
  const t = useTranslations("settings.retention");
  const fmt = useFormatter();
  const total = RETENTION_KEYS.reduce((n, k) => n + summary.counts[k], 0);
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      <p className="text-muted-foreground text-xs">
        {t(summary.dryRun ? "previewAt" : summary.trigger === "system" ? "ranAutomatically" : "ranManually", {
          when: fmt.dateTime(new Date(summary.finishedAt), { dateStyle: "medium", timeStyle: "short" }),
        })}
      </p>
      {total === 0 ? (
        <p>{t("nothingDue")}</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {RETENTION_KEYS.filter((k) => summary.counts[k] > 0).map((k) => (
            <li key={k} className="flex justify-between gap-3 border-b border-dashed py-1">
              <span>{t(`counts.${k}`)}</span>
              <span className="font-medium tabular-nums">{fmt.number(summary.counts[k])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Preview and run act on the SAVED periods, not on unsaved edits. */
function RunCard() {
  const t = useTranslations("settings.retention");
  const qc = useQueryClient();
  const overview = useApiQuery<Overview>(RETENTION);
  const [preview, setPreview] = useState<RetentionSummary | null>(null);
  const run = useApiMutation((dryRun: boolean) => api<{ summary: RetentionSummary }>(RETENTION, { body: { dryRun } }), {
    onSuccess: (r) => {
      if (r.summary.dryRun) setPreview(r.summary);
      else {
        setPreview(null);
        void qc.invalidateQueries({ queryKey: [RETENTION] });
      }
    },
  });
  const last = overview.data?.last ?? null;
  return (
    <SettingCard title={t("runTitle")} description={t("runHint")}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={run.isPending} onClick={() => run.mutate(true)}>
          <Eye aria-hidden />
          {t("preview")}
        </Button>
        <ConfirmButton
          variant="default"
          size="default"
          icon={<Play aria-hidden />}
          label={t("runNow")}
          title={t("runNowTitle")}
          description={t("runNowBody")}
          disabled={run.isPending}
          onConfirm={() => run.mutateAsync(false)}
        />
      </div>
      {preview && (
        <div className="bg-muted/40 rounded-lg border p-3">
          <h4 className="mb-1 text-sm font-medium">{t("previewTitle")}</h4>
          <Counts summary={preview} />
        </div>
      )}
      <div>
        <h4 className="mb-1 text-sm font-medium">{t("lastRun")}</h4>
        {last ? <Counts summary={last} /> : <p className="text-muted-foreground text-sm">{t("neverRan")}</p>}
      </div>
    </SettingCard>
  );
}

export function RetentionSection({ initial }: { initial: SettingValue<"privacy"> }) {
  const t = useTranslations("settings");
  return (
    <>
      <SettingForm k="privacy" initial={initial}>
        {(v, set) => (
          <>
            <SettingCard title={t("retention.cardVisitors")} description={t("retention.zeroKeeps")} columns={2}>
              <NumField
                id="pv-ret"
                label={t("retentionDays")}
                hint={t("retentionHint")}
                value={v.retentionDays}
                min={0}
                max={3650}
                onChange={(retentionDays) => set({ retentionDays })}
              />
              <NumField
                id="pv-tickets"
                label={t("ticketDataDays")}
                hint={t("ticketDataDaysHint")}
                value={v.ticketDataDays}
                min={0}
                max={3650}
                onChange={(ticketDataDays) => set({ ticketDataDays })}
              />
              <NumField
                id="pv-comments"
                label={t("commentDays")}
                hint={t("commentDaysHint")}
                value={v.commentDays}
                min={0}
                max={3650}
                onChange={(commentDays) => set({ commentDays })}
              />
              <NumField
                id="pv-notif"
                label={t("notificationDays")}
                hint={t("notificationDaysHint")}
                value={v.notificationDays}
                min={0}
                max={3650}
                onChange={(notificationDays) => set({ notificationDays })}
              />
            </SettingCard>
            <SettingCard title={t("retention.cardSystem")} columns={2}>
              <NumField
                id="pv-audit"
                label={t("auditDays")}
                hint={t("auditDaysHint")}
                value={v.auditDays}
                min={0}
                max={3650}
                onChange={(auditDays) => set({ auditDays })}
              />
              <NumField
                id="pv-cred"
                label={t("credentialDays")}
                hint={t("credentialDaysHint")}
                value={v.credentialDays}
                min={0}
                max={3650}
                onChange={(credentialDays) => set({ credentialDays })}
              />
            </SettingCard>
          </>
        )}
      </SettingForm>
      <RunCard />
    </>
  );
}
