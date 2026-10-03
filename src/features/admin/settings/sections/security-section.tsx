"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import type { RoleRow } from "../../types";
import { useText } from "../../use-lookups";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

export function SecuritySection({ initial, roles }: { initial: SettingValue<"security">; roles: RoleRow[] }) {
  const t = useTranslations("settings");
  const text = useText();
  return (
    <SettingForm k="security" initial={initial}>
      {(v, set) => {
        const pp = v.passwordPolicy;
        const setPp = (patch: Partial<typeof pp>) => set({ passwordPolicy: { ...pp, ...patch } });
        return (
          <>
            <SettingCard title={t("passwordPolicy")}>
              <div id="sc-policy" className="space-y-4">
                <NumField
                  id="sc-min"
                  label={t("minLength")}
                  value={pp.minLength}
                  min={8}
                  max={128}
                  className="max-w-40"
                  onChange={(minLength) => setPp({ minLength })}
                />
                <div className="grid gap-x-5 sm:grid-cols-2">
                  <Check
                    id="sc-upper"
                    label={t("requireUpper")}
                    checked={pp.requireUpper}
                    onChange={(requireUpper) => setPp({ requireUpper })}
                  />
                  <Check
                    id="sc-lower"
                    label={t("requireLower")}
                    checked={pp.requireLower}
                    onChange={(requireLower) => setPp({ requireLower })}
                  />
                  <Check
                    id="sc-digit"
                    label={t("requireDigit")}
                    checked={pp.requireDigit}
                    onChange={(requireDigit) => setPp({ requireDigit })}
                  />
                  <Check
                    id="sc-symbol"
                    label={t("requireSymbol")}
                    checked={pp.requireSymbol}
                    onChange={(requireSymbol) => setPp({ requireSymbol })}
                  />
                </div>
              </div>
            </SettingCard>
            <SettingCard title={t("cards.signIn")} columns={3}>
              <NumField
                id="sc-fail"
                label={t("maxFailedLogins")}
                value={v.maxFailedLogins}
                min={3}
                max={20}
                onChange={(maxFailedLogins) => set({ maxFailedLogins })}
              />
              <NumField
                id="sc-lock"
                label={t("lockoutMinutes")}
                value={v.lockoutMinutes}
                min={1}
                max={1440}
                onChange={(lockoutMinutes) => set({ lockoutMinutes })}
              />
              <NumField
                id="sc-inv"
                label={t("inviteExpiryHours")}
                value={v.inviteExpiryHours}
                min={1}
                max={720}
                onChange={(inviteExpiryHours) => set({ inviteExpiryHours })}
              />
              <Check
                id="sc-signup"
                label={t("selfSignupEnabled")}
                checked={v.selfSignupEnabled}
                onChange={(selfSignupEnabled) => set({ selfSignupEnabled })}
              />
            </SettingCard>
            <SettingCard title={t("require2faForRoles")}>
              <fieldset id="sc-2fa">
                <legend className="sr-only">{t("require2faForRoles")}</legend>
                <div className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
                  {roles.map((r) => (
                    <Check
                      key={r.id}
                      label={text(r.name)}
                      checked={v.require2faForRoles.includes(r.key)}
                      onChange={(on) =>
                        set({
                          require2faForRoles: on
                            ? [...v.require2faForRoles, r.key]
                            : v.require2faForRoles.filter((k) => k !== r.key),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
            </SettingCard>
          </>
        );
      }}
    </SettingForm>
  );
}
