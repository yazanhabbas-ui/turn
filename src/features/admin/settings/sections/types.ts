import type { SettingKey, SettingValue } from "@/server/settings/registry";

export type AllSettings = { [K in SettingKey]: SettingValue<K> };
