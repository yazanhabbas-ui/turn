"use client";

import { Camera, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useErrorMessage } from "@/components/admin/use-api";
import { UserAvatar, type AvatarUser } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Profile picture with change / remove. A chosen file is previewed in a square (cropped to fit) before it is saved. */
export function AvatarEditor({ user }: { user: AvatarUser }) {
  const t = useTranslations("profile");
  const message = useErrorMessage();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState<number | null>(user.avatarVersion ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f: File | undefined) {
    if (!f) return;
    if (!TYPES.includes(f.type)) return void toast.error(t("avatar.errors.type"));
    if (f.size > MAX_BYTES) return void toast.error(t("avatar.errors.size"));
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/v1/me/avatar", { method: "POST", body, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "server_error", data?.error?.details);
      setVersion(data.avatarVersion);
      setFile(null);
      toast.success(t("avatar.saved"));
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api("/api/v1/me/avatar", { method: "DELETE" });
      setVersion(null);
      setFile(null);
      toast.success(t("avatar.removed"));
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={t("avatar.preview")} className="size-28 rounded-full object-cover" />
      ) : (
        <UserAvatar user={{ ...user, avatarVersion: version }} size="xl" />
      )}
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        className="sr-only"
        aria-label={t("avatar.choose")}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={upload} disabled={busy}>
            {t("avatar.save")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFile(null)} disabled={busy}>
            {t("avatar.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
            <Camera aria-hidden />
            {version === null ? t("avatar.add") : t("avatar.change")}
          </Button>
          {version !== null && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
              <Trash2 aria-hidden />
              {t("avatar.remove")}
            </Button>
          )}
        </div>
      )}
      <p className="text-muted-foreground max-w-48 text-center text-xs">{t("avatar.hint")}</p>
    </div>
  );
}
