import { BookOpen, Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/admin/form";
import type { ManualFile } from "@/server/help/manuals";

const API = "/api/v1/help/manuals";

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Card({ m }: { m: ManualFile }) {
  const t = useTranslations("help");
  const href = `${API}/${m.lang}/${m.file}`;
  return (
    <li className="bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <BookOpen className="text-brand mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{t(`topics.${m.topic}.title`)}</p>
          <p className="text-muted-foreground text-sm">{t(`topics.${m.topic}.for`)}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-sm">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium"
        >
          <ExternalLink className="size-4" aria-hidden />
          {t("open")}
        </a>
        <a
          href={`${href}?download=1`}
          className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium"
        >
          <Download className="size-4" aria-hidden />
          {t("download")}
        </a>
        <span className="text-muted-foreground tabular ms-auto text-xs">PDF · {size(m.bytes)}</span>
      </div>
    </li>
  );
}

/** The knowledge base: the manuals that fit this person's role, in the app language; the other language is one click away. */
export function HelpPage({
  lang,
  items,
  otherLang,
  otherItems,
}: {
  lang: string;
  items: ManualFile[];
  otherLang: string;
  otherItems: ManualFile[];
}) {
  const t = useTranslations("help");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label={t(`lang.${lang}`)}>
          {items.map((m) => (
            <Card key={m.file} m={m} />
          ))}
        </ul>
      )}
      {otherItems.length > 0 && (
        <details className="mt-8">
          <summary className="text-muted-foreground cursor-pointer text-sm font-medium">
            {t("otherLanguage", { language: t(`lang.${otherLang}`) })}
          </summary>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {otherItems.map((m) => (
              <Card key={m.file} m={m} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
