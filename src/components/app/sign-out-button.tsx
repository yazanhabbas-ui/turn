"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";

export function SignOutButton() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await api("/api/v1/auth/logout", { body: {} }).catch(() => undefined);
        // The offline page copies kept by the service worker belong to the person who just left this device.
        if ("caches" in window)
          await caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k.endsWith("-pages")).map((k) => caches.delete(k))))
            .catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut className="rtl-flip" aria-hidden />
      {t("signOut")}
    </Button>
  );
}
