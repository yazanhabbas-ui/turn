"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** A button that asks for confirmation before running a destructive or irreversible action. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = "outline",
  size = "sm",
  disabled,
  icon,
}: {
  label: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: "outline" | "destructive" | "ghost" | "secondary" | "default";
  size?: "sm" | "default" | "icon-sm";
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={size === "icon-sm" ? label : undefined}
      >
        {icon}
        {size !== "icon-sm" && label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel ?? t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
