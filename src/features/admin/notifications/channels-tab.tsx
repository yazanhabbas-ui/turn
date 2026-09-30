"use client";

import { Mail, MessageCircle, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingCard } from "../settings/setting-card";

type Providers = {
  providers: {
    channel: "whatsapp" | "sms" | "email";
    state: "configured" | "not_configured" | "mock";
    provider: string | null;
  }[];
};
export const PROVIDERS = "/api/v1/admin/notifications/providers";
const ICONS = { whatsapp: MessageCircle, sms: Smartphone, email: Mail } as const;

/** One card per channel: is it configured, mock or off. Secrets live in the server environment and are never shown. */
export function ChannelsTab({ canTest }: { canTest: boolean }) {
  const t = useTranslations("notifications");
  const q = useApiQuery<Providers>(PROVIDERS);
  const [channel, setChannel] = useState<"whatsapp" | "sms" | "email">("email");
  const [to, setTo] = useState("");
  const [locale, setLocale] = useState<"ar" | "en">("ar");
  const test = useApiMutation(
    (body: { channel: string; to: string; locale: string }) =>
      api<{ ok: boolean; error: string | null }>("/api/v1/admin/notifications/test", { method: "POST", body }),
    { success: t("test.sent") },
  );

  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {q.data.providers.map((p) => {
          const Icon = ICONS[p.channel];
          return (
            <section key={p.channel} className="bg-card space-y-2 rounded-xl border p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Icon className="text-muted-foreground size-5" aria-hidden />
                <h3 className="font-semibold">{t(`channels.${p.channel}`)}</h3>
                <Badge
                  variant={p.state === "configured" ? "default" : p.state === "mock" ? "secondary" : "outline"}
                  className="ms-auto"
                >
                  {t(`status.${p.state}`)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">{t(`setup.${p.channel}`)}</p>
              {p.provider && (
                <p className="text-xs" dir="ltr">
                  {p.provider}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <p className="text-muted-foreground text-sm">{t("channelsHelp")}</p>
      {canTest && (
        <SettingCard title={t("test.title")} description={t("test.description")} columns={3}>
          <Field label={t("test.channel")} htmlFor="nt-channel">
            <NativeSelect id="nt-channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              {(["whatsapp", "sms", "email"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`channels.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={channel === "email" ? t("test.toEmail") : t("test.toPhone")} htmlFor="nt-to">
            <Input
              id="nt-to"
              dir="ltr"
              inputMode={channel === "email" ? "email" : "tel"}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label={t("test.language")} htmlFor="nt-lang">
            <NativeSelect id="nt-lang" value={locale} onChange={(e) => setLocale(e.target.value as "ar" | "en")}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </NativeSelect>
          </Field>
          <div className="sm:col-span-3">
            <Button disabled={!to.trim() || test.isPending} onClick={() => test.mutate({ channel, to, locale })}>
              {t("test.send")}
            </Button>
            {test.data && !test.data.ok && (
              <p className="text-destructive mt-2 text-sm" role="alert" dir="auto">
                {test.data.error}
              </p>
            )}
          </div>
        </SettingCard>
      )}
    </div>
  );
}
