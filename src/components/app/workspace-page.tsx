import { Inbox } from "lucide-react";
import type { Permission } from "@/domain/rbac/permissions";
import type { AreaKey } from "@/lib/areas";
import { requireAuth } from "@/server/auth/current";
import { AppShell, Forbidden } from "./app-shell";

/** Permission-gated workspace wrapper with an empty state until the area's UI is rendered. */
export async function WorkspacePage({
  locale,
  area,
  permission,
  emptyText,
  children,
}: {
  locale: string;
  area: AreaKey;
  permission: Permission;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  const { auth, allowed } = await requireAuth(locale, permission);
  return (
    <AppShell auth={auth} area={area}>
      {!allowed ? (
        <Forbidden />
      ) : (
        (children ?? (
          <div className="text-muted-foreground mx-auto mt-16 max-w-md text-center">
            <Inbox className="mx-auto size-12" aria-hidden />
            <p className="mt-4">{emptyText}</p>
          </div>
        ))
      )}
    </AppShell>
  );
}
