import { setRequestLocale } from "next-intl/server";
import { AppShell, Forbidden } from "@/components/app/app-shell";
import { AdminSidebar } from "@/features/admin/admin-sidebar";
import { requireAuth } from "@/server/auth/current";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "admin.access");
  const permissions = [...new Set(auth.grants.flatMap((g) => g.permissions))];
  return (
    <AppShell auth={auth} area="admin" sidebar={allowed ? <AdminSidebar permissions={permissions} /> : undefined}>
      {allowed ? children : <Forbidden />}
    </AppShell>
  );
}
