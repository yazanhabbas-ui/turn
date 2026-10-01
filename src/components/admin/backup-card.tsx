import { DatabaseBackup } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { backupStatus } from "@/server/admin/backup-status";
import type { Actor } from "@/server/admin/actor";

/** Small "last backup" indicator for the admin overview. Renders nothing unless the admin may manage settings organization-wide. */
export async function BackupCard({ actor }: { actor: Actor }) {
  let status;
  try {
    status = backupStatus(actor);
  } catch {
    return null;
  }
  const t = await getTranslations("admin.backup");
  const f = await getFormatter();
  const tone =
    status.state === "ok"
      ? "text-emerald-700 dark:text-emerald-400"
      : status.state === "none"
        ? "text-muted-foreground"
        : "text-destructive";
  return (
    <div className="bg-card mt-4 rounded-xl border p-4 shadow-sm" data-testid="backup-card">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <DatabaseBackup className="size-4" aria-hidden />
        {t("title")}
      </div>
      <div className={`mt-2 font-semibold ${tone}`}>{t(`state.${status.state}`)}</div>
      {status.lastSuccess && (
        <p className="text-muted-foreground mt-1 text-sm">
          {t("last", { when: f.dateTime(new Date(status.lastSuccess.finishedAt), { dateStyle: "medium", timeStyle: "short" }) })}
          {status.lastSuccess.verifiedRestore ? ` · ${t("verified")}` : ""}
        </p>
      )}
      {status.lastFailure && (
        <p className="text-destructive mt-1 text-sm">
          {t("failedAt", { when: f.dateTime(new Date(status.lastFailure.at), { dateStyle: "medium", timeStyle: "short" }) })}
        </p>
      )}
      {status.state === "none" && <p className="text-muted-foreground mt-1 text-sm">{t("noneHint")}</p>}
    </div>
  );
}
