import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("common");
  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center">
      <p className="tabular text-brand text-6xl font-bold">404</p>
      <h1 className="mt-4 text-xl font-bold">{t("notFound")}</h1>
      <p className="text-muted-foreground mt-2">{t("notFoundBody")}</p>
      <Link href="/" className="text-brand mt-6 inline-block underline underline-offset-4">
        {t("goHome")}
      </Link>
    </div>
  );
}
