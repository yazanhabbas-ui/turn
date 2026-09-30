"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export type AvatarUser = {
  id: string;
  displayName?: Record<string, string> | null;
  /** Used instead of `displayName` when the caller already has a plain name. */
  name?: string;
  email?: string | null;
  /** Version of the picture (cache key); null or absent = the user has none. */
  avatarVersion?: number | null;
  hasAvatar?: boolean;
};

const SIZES = { xs: 24, sm: 32, md: 40, lg: 64, xl: 112 } as const;
export type AvatarSize = keyof typeof SIZES | number;

/** Soft, readable background colours for the initials; picked by a hash of the user id so a person keeps theirs. */
const TONES = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200",
];

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0])[0] ?? "?";
  const second = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + second).toUpperCase();
}

function toneOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Round profile picture; falls back to coloured initials when the user has none (or it fails to load). */
export function UserAvatar({ user, size = "md", className }: { user: AvatarUser; size?: AvatarSize; className?: string }) {
  const locale = useLocale();
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const px = typeof size === "number" ? size : SIZES[size];
  const version = user.avatarVersion ?? (user.hasAvatar ? 0 : null);
  const name = user.name ?? pickText(user.displayName ?? {}, locale, user.email ?? "");
  const showImage = version !== null && failedVersion !== version;

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold select-none",
        toneOf(user.id),
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.max(10, Math.round(px * 0.4)) }}
      role="img"
      aria-label={name}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/users/${user.id}/avatar?v=${version}`}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailedVersion(version)}
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}
