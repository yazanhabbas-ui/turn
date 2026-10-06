import { redirect } from "@/i18n/navigation";

/** Settings moved out of Administration into its own app; old links and bookmarks land there. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = Object.fromEntries(
    Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  );
  redirect({ href: { pathname: "/settings", query }, locale });
}
