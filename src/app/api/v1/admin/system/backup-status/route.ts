import { backupStatus } from "@/server/admin/backup-status";
import { route } from "@/server/http/route";

/** When the last database backup finished (read from backups/last-success.json). Organization-wide `settings.manage`. */
export const GET = route({ permission: "settings.manage" }, async ({ actor }) => backupStatus(actor));
