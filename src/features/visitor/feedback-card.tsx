"use client";

import { useMutation } from "@tanstack/react-query";
import { Angry, Frown, Laugh, Loader2, Meh, Smile, Star, type LucideIcon } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { pickText } from "@/i18n/locales";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePageText } from "../pagecontent/page-text";

export type FeedbackCardConfig = {
  style: "stars" | "faces";
  askComment: boolean;
  askNps: boolean;
  prompt: Record<string, string>;
  commentPrompt: Record<string, string>;
  npsPrompt: Record<string, string>;
  thanks: Record<string, string>;
  commentMax: number;
  answered: boolean;
};

const FACES: LucideIcon[] = [Angry, Frown, Meh, Smile, Laugh];
const SCORES = [1, 2, 3, 4, 5] as const;

/**
 * "How was your visit?" card on the visitor page. Native radio inputs give keyboard use (arrow keys, also mirrored
 * in right-to-left) and screen-reader semantics for free; the faces or stars are just their labels.
 */
export function FeedbackCard({
  token,
  config,
  autoFocus = false,
}: {
  token: string;
  config: FeedbackCardConfig;
  /** Opened from the feedback link: scroll to the card and focus it. */
  autoFocus?: boolean;
}) {
  const t = usePageText("visitor");
  const locale = useLocale();
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [score, setScore] = useState<number | null>(null);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(config.answered);

  useEffect(() => {
    if (!autoFocus) return;
    rootRef.current?.scrollIntoView({ block: "center" });
    rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const send = useMutation({
    mutationFn: () =>
      api(`/api/v1/public/tickets/${token}/feedback`, {
        method: "POST",
        body: {
          score,
          nps: config.askNps ? nps : null,
          comment: config.askComment && comment.trim() ? comment.trim() : null,
          channel: autoFocus ? "link" : "status_page",
          language: locale === "en" ? "en" : "ar",
        },
      }),
    onSuccess: () => setDone(true),
    // Answered already (another tab, or the link): show the thank-you rather than an error.
    onError: (err) => {
      if (err instanceof ApiError && err.code === "conflict") setDone(true);
    },
  });
  const failed = send.isError && !(send.error instanceof ApiError && send.error.code === "conflict");

  if (done) {
    return (
      <section
        ref={rootRef}
        tabIndex={-1}
        role="status"
        className="bg-card mt-8 w-full max-w-sm rounded-2xl border p-5 text-center shadow-sm outline-none"
      >
        <Smile className="text-brand mx-auto size-10" aria-hidden />
        <p className="mt-3 text-lg font-semibold">{pickText(config.thanks, locale) || t("feedback.thanks")}</p>
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={`${uid}-title`}
      className="bg-card mt-8 w-full max-w-sm rounded-2xl border p-5 text-start shadow-sm outline-none"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (score !== null && !send.isPending) send.mutate();
        }}
        className="space-y-5"
      >
        <fieldset>
          <legend id={`${uid}-title`} className="w-full text-center text-lg font-semibold">
            {pickText(config.prompt, locale) || t("feedback.prompt")}
          </legend>
          <div className="mt-4 flex justify-center gap-1.5 sm:gap-2">
            {SCORES.map((n) => {
              const Icon = FACES[n - 1];
              const lit = config.style === "stars" && score !== null && n <= score;
              return (
                <label
                  key={n}
                  className={cn(
                    "text-muted-foreground has-focus-visible:ring-ring/60 hover:bg-muted relative grid size-14 cursor-pointer place-items-center rounded-xl border transition-colors has-focus-visible:ring-3",
                    score === n && config.style === "faces" && "border-brand bg-brand/10 text-brand ring-brand ring-2",
                    config.style === "stars" && (lit || score === n) && "text-status-called border-transparent",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-score`}
                    value={n}
                    checked={score === n}
                    onChange={() => setScore(n)}
                    className="sr-only"
                    aria-label={t(`feedback.scores.${n}`)}
                  />
                  {config.style === "stars" ? (
                    <Star className={cn("size-9", lit && "fill-current")} aria-hidden />
                  ) : (
                    <Icon className="size-9" aria-hidden />
                  )}
                </label>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-2 h-5 text-center text-sm" aria-live="polite">
            {score !== null ? t(`feedback.scores.${score}`) : ""}
          </p>
        </fieldset>

        {config.askNps && (
          <fieldset>
            <legend className="text-sm font-medium">{pickText(config.npsPrompt, locale) || t("feedback.npsPrompt")}</legend>
            <div className="mt-2 grid grid-cols-6 gap-1.5" dir="ltr">
              {Array.from({ length: 11 }, (_, n) => (
                <label
                  key={n}
                  className={cn(
                    "has-focus-visible:ring-ring/60 hover:bg-muted tabular grid h-10 cursor-pointer place-items-center rounded-lg border text-sm font-medium has-focus-visible:ring-3",
                    nps === n && "border-brand bg-brand/10 text-brand ring-brand ring-2",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-nps`}
                    value={n}
                    checked={nps === n}
                    onChange={() => setNps(n)}
                    className="sr-only"
                  />
                  {n}
                </label>
              ))}
            </div>
            <div className="text-muted-foreground mt-1 flex justify-between text-xs">
              <span>{t("feedback.npsLow")}</span>
              <span>{t("feedback.npsHigh")}</span>
            </div>
          </fieldset>
        )}

        {config.askComment && (
          <div>
            <label htmlFor={`${uid}-comment`} className="text-sm font-medium">
              {pickText(config.commentPrompt, locale) || t("feedback.commentPrompt")}
            </label>
            <textarea
              id={`${uid}-comment`}
              rows={3}
              maxLength={config.commentMax}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 w-full rounded-lg border px-3 py-2 text-base outline-none focus-visible:ring-3"
            />
          </div>
        )}

        {failed && (
          <p role="alert" className="text-destructive text-sm">
            {t("feedback.failed")}
          </p>
        )}
        <button
          type="submit"
          disabled={score === null || send.isPending}
          className="bg-brand focus-visible:ring-ring/60 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold text-white outline-none focus-visible:ring-3 disabled:opacity-50"
        >
          {send.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("feedback.submit")}
        </button>
      </form>
    </section>
  );
}
