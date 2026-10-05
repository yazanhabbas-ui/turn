"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, renderMessage, TEMPLATE_VARIABLES } from "@/domain/notifications/policy";
import { cn } from "@/lib/utils";
import { Check } from "../settings/setting-field";

type Loc = Record<string, string>;
type Item = {
  channel: (typeof NOTIFICATION_CHANNELS)[number];
  event: (typeof NOTIFICATION_EVENTS)[number];
  subject: Loc | null;
  body: Loc;
  providerTemplate: string | null;
  isActive: boolean;
  isDefault: boolean;
  defaults: { subject: Loc | null; body: Loc };
};
const LIST = "/api/v1/admin/notifications/templates";
const LANGS = ["ar", "en"] as const;

/** Wording of every visitor message: pick an event and a channel, edit both languages, see the result live. */
export function TemplatesTab() {
  const t = useTranslations("notifications");
  const q = useApiQuery<{ items: Item[] }>(LIST);
  const [event, setEvent] = useState<Item["event"]>("ticket_issued");
  const [channel, setChannel] = useState<Item["channel"]>("whatsapp");
  const item = q.data?.items.find((i) => i.event === event && i.channel === channel);

  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label={t("templates.event")} htmlFor="nt-tpl-event" className="min-w-56">
          <NativeSelect id="nt-tpl-event" value={event} onChange={(e) => setEvent(e.target.value as Item["event"])}>
            {NOTIFICATION_EVENTS.map((e) => (
              <option key={e} value={e}>
                {t(`events.names.${e}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("templates.channel")} htmlFor="nt-tpl-channel" className="min-w-40">
          <NativeSelect id="nt-tpl-channel" value={channel} onChange={(e) => setChannel(e.target.value as Item["channel"])}>
            {NOTIFICATION_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {item && <TemplateEditor key={`${item.channel}:${item.event}:${item.isDefault}`} item={item} />}
    </div>
  );
}

function TemplateEditor({ item }: { item: Item }) {
  const t = useTranslations("notifications");
  const [body, setBody] = useState<Loc>({ ar: item.body.ar ?? "", en: item.body.en ?? "" });
  const [subject, setSubject] = useState<Loc>({ ar: item.subject?.ar ?? "", en: item.subject?.en ?? "" });
  const [providerTemplate, setProviderTemplate] = useState(item.providerTemplate ?? "");
  const [active, setActive] = useState(item.isActive);
  const [focus, setFocus] = useState<(typeof LANGS)[number]>("ar");
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const isEmail = item.channel === "email";

  const save = useSaveTemplate(item, { body, subject, providerTemplate, active, isEmail });

  const insert = (name: string) => {
    const el = refs.current[focus];
    const token = `{${name}}`;
    const start = el?.selectionStart ?? body[focus].length;
    const end = el?.selectionEnd ?? start;
    const next = body[focus].slice(0, start) + token + body[focus].slice(end);
    setBody((b) => ({ ...b, [focus]: next }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="bg-card space-y-4 rounded-xl border p-4 shadow-sm">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <p className="text-sm font-medium">{t("templates.variables")}</p>
            <InfoTip>{t("templates.variablesHint")}</InfoTip>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("templates.variables")}>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                dir="ltr"
                onClick={() => insert(v)}
                title={t(`variables.${v}`)}
                className="bg-muted hover:bg-accent focus-visible:ring-ring/50 rounded-md border px-2 py-0.5 font-mono text-xs outline-none focus-visible:ring-3"
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
        </div>
        {isEmail &&
          LANGS.map((l) => (
            <Field
              key={l}
              label={`${t("templates.subject")} (${l === "ar" ? "العربية" : "English"})`}
              htmlFor={`nt-subject-${l}`}
            >
              <Input
                id={`nt-subject-${l}`}
                dir={l === "ar" ? "rtl" : "ltr"}
                value={subject[l]}
                maxLength={200}
                onChange={(e) => setSubject((s) => ({ ...s, [l]: e.target.value }))}
              />
            </Field>
          ))}
        {LANGS.map((l) => (
          <Field key={l} label={`${t("templates.body")} (${l === "ar" ? "العربية" : "English"})`} htmlFor={`nt-body-${l}`}>
            <Textarea
              id={`nt-body-${l}`}
              ref={(el) => {
                refs.current[l] = el;
              }}
              dir={l === "ar" ? "rtl" : "ltr"}
              rows={5}
              maxLength={2000}
              value={body[l]}
              onFocus={() => setFocus(l)}
              onChange={(e) => setBody((b) => ({ ...b, [l]: e.target.value }))}
            />
          </Field>
        ))}
        {item.channel === "whatsapp" && (
          <Field
            label={t("templates.providerTemplate")}
            htmlFor="nt-provider-template"
            hint={t("templates.providerTemplateHint")}
          >
            <Input
              id="nt-provider-template"
              dir="ltr"
              maxLength={100}
              value={providerTemplate}
              onChange={(e) => setProviderTemplate(e.target.value)}
            />
          </Field>
        )}
        <Check id="nt-tpl-active" label={t("templates.active")} checked={active} onChange={setActive} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={save.isPending || !body.ar.trim() || !body.en.trim()} onClick={() => save.mutate(undefined)}>
            {t("templates.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setBody({ ar: item.defaults.body.ar, en: item.defaults.body.en });
              setSubject({ ar: item.defaults.subject?.ar ?? "", en: item.defaults.subject?.en ?? "" });
            }}
          >
            {t("templates.restore")}
          </Button>
        </div>
      </div>
      <Preview body={body} subject={isEmail ? subject : null} channel={item.channel} />
    </div>
  );
}

function useSaveTemplate(
  item: Item,
  s: { body: Loc; subject: Loc; providerTemplate: string; active: boolean; isEmail: boolean },
) {
  const t = useTranslations("notifications");
  return useApiMutation(
    () =>
      api("/api/v1/admin/templates", {
        method: "PUT",
        body: {
          channel: item.channel,
          event: item.event,
          subject: s.isEmail ? s.subject : null,
          body: s.body,
          providerTemplate: item.channel === "whatsapp" ? s.providerTemplate || null : undefined,
          isActive: s.active,
        },
      }),
    { invalidate: [[LIST]], success: t("templates.saved") },
  );
}

/** What the visitor would receive, with sample values, in both languages. */
function Preview({ body, subject, channel }: { body: Loc; subject: Loc | null; channel: string }) {
  const t = useTranslations("notifications");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("templates.preview")}</h3>
      {LANGS.map((l) => {
        const vars = {
          number: "A-014",
          ticket: "A-014",
          name: t(`sample.name.${l}`),
          desk: "3",
          hall: "",
          wait: t(`sample.wait.${l}`),
          ahead: "2",
          branch: t(`sample.branch.${l}`),
          reason: t(`sample.reason.${l}`),
          link: "https://queue.example/t/xxxx",
          feedbackLink: "",
          stopLink: "https://queue.example/t/xxxx/stop",
        };
        return (
          <div key={l} className="bg-card rounded-xl border p-3 shadow-sm" dir={l === "ar" ? "rtl" : "ltr"}>
            <p className="text-muted-foreground mb-1 text-xs" dir="ltr">
              {l.toUpperCase()} · {t(`channels.${channel as "sms"}`)}
            </p>
            {subject && <p className="mb-1 font-semibold">{renderMessage(subject[l], vars)}</p>}
            <p className={cn("text-sm leading-relaxed whitespace-pre-line", !body[l] && "text-muted-foreground")}>
              {renderMessage(body[l], vars) || "—"}
            </p>
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">{t("templates.previewHint")}</p>
    </div>
  );
}
