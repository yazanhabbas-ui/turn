"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { useErrorMessage } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/v1/admin/branding/logo";
const SETTINGS = "/api/v1/admin/settings";
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const REASONS = ["too_large", "unsupported_type", "animated", "empty", "missing", "invalid_form"];

export type LogoVariant = "light" | "dark";

const CHECKERBOARD =
  "bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-[image:linear-gradient(45deg,#d4d4d8_25%,transparent_25%,transparent_75%,#d4d4d8_75%),linear-gradient(45deg,#d4d4d8_25%,#fff_25%,#fff_75%,#d4d4d8_75%)]";
/** Dark checkerboard: a white logo stays visible on it. */
const CHECKERBOARD_DARK =
  "bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-[image:linear-gradient(45deg,#262626_25%,transparent_25%,transparent_75%,#262626_75%),linear-gradient(45deg,#262626_25%,#0a0a0a_25%,#0a0a0a_75%,#262626_75%)]";

/** POST with upload progress (fetch cannot report it). Resolves with the parsed JSON or rejects with an ApiError. */
function upload(
  file: File,
  variant: LogoVariant,
  onProgress: (pct: number) => void,
): Promise<{ version: number; logoUrl: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", ENDPOINT);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.onload = () => {
      let data: { error?: { code?: string; details?: Record<string, unknown> } } & { version: number; logoUrl: string };
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {} as typeof data;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error?.code ?? "server_error", data?.error?.details));
    };
    const body = new FormData();
    body.append("file", file);
    body.append("variant", variant);
    xhr.send(body);
  });
}

/**
 * Logo upload for the Branding settings. Shows the current logo on a transparency checkerboard and on light and dark
 * strips, takes a file by button or drag-and-drop, and calls the logo endpoints itself (which also update the
 * `branding.logoUrl` setting). `onChange` is only for the "use a link instead" field (it edits the form's draft value);
 * `onUploaded` is called with the new `logoUrl` after an upload (or `null` after a removal).
 */
export function LogoUploader({
  value,
  variant = "light",
  onChange,
  onUploaded,
}: {
  value: string | null;
  /** light = the main logo (light backgrounds); dark = the optional logo for dark and brand-coloured screens. */
  variant?: LogoVariant;
  onChange?: (url: string | null) => void;
  onUploaded?: (url: string | null) => void;
}) {
  const t = useTranslations("logoUpload");
  const message = useErrorMessage();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (err: unknown) => {
    const reason = err instanceof ApiError ? (err.details?.reason as string | undefined) : undefined;
    return err instanceof ApiError && err.code === "validation" && reason && REASONS.includes(reason)
      ? t(`errors.${reason}`)
      : message(err);
  };

  const done = (url: string | null) => {
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(SETTINGS) });
    onUploaded?.(url);
  };

  async function send(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError(t("errors.unsupported_type"));
    if (file.size > MAX_BYTES) return setError(t("errors.too_large"));
    setBusy(true);
    setProgress(0);
    try {
      const res = await upload(file, variant, setProgress);
      toast.success(t("saved"));
      done(res.logoUrl);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(variant === "dark" ? `${ENDPOINT}?variant=dark` : ENDPOINT, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data?.error?.code ?? "server_error", data?.error?.details);
      }
      toast.success(t("removed"));
      done(null);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  const dark = variant === "dark";
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{dark ? t("titleDark") : t("titleLight")}</div>
      {dark && <p className="text-muted-foreground text-xs">{t("darkHint")}</p>}

      {value && (
        <div className="space-y-2">
          <div
            className={cn(
              "grid h-28 place-items-center overflow-hidden rounded-lg border p-3",
              dark ? CHECKERBOARD_DARK : CHECKERBOARD,
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={dark ? t("previewDark") : t("preview")} className="max-h-20 max-w-full object-contain" />
          </div>
          <div className={cn("grid gap-2", !dark && "grid-cols-2")}>
            {!dark && (
              <div className="grid h-16 place-items-center overflow-hidden rounded-lg border bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={value} alt="" className="max-h-10 max-w-full object-contain" />
              </div>
            )}
            <div className="grid h-16 place-items-center overflow-hidden rounded-lg border bg-neutral-900 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt="" className="max-h-10 max-w-full object-contain" />
            </div>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void send(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <input
          ref={input}
          type="file"
          accept={TYPES.join(",")}
          className="sr-only"
          aria-label={t("choose")}
          onChange={(e) => {
            void send(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy && progress !== null ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <Loader2 className="animate-spin" aria-hidden />
            {progress < 100 ? t("uploading", { percent: progress }) : t("processing")}
          </div>
        ) : (
          <>
            <ImageUp className="text-muted-foreground size-6" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("drop")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
                {value ? t("replace") : t("choose")}
              </Button>
              {value && (
                <ConfirmButton
                  label={t("remove")}
                  title={dark ? t("removeTitleDark") : t("removeTitle")}
                  description={dark ? t("removeBodyDark") : t("removeBody")}
                  confirmLabel={t("remove")}
                  variant="destructive"
                  disabled={busy}
                  icon={<Trash2 aria-hidden />}
                  onConfirm={remove}
                />
              )}
            </div>
          </>
        )}
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {onChange && (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer select-none">{t("advanced")}</summary>
          <div className="mt-2 space-y-1">
            <Input
              dir="ltr"
              aria-label={dark ? t("linkLabelDark") : t("linkLabel")}
              placeholder="/branding/logo.png"
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value || null)}
            />
            <p className="text-muted-foreground text-xs">{t("linkHint")}</p>
          </div>
        </details>
      )}
    </div>
  );
}
