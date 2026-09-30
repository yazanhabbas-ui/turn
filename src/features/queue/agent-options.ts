import type { PickerOption } from "@/components/admin/agent-picker";
import { pickText } from "@/i18n/locales";
import type { L } from "./types";

/** Picker options for agents in the queue screens: searchable in every language, with a live status dot. */
export function queueAgentOptions(
  agents: { id: string; displayName: L; status: string }[],
  locale: string,
  statusLabel: (status: string) => string,
): PickerOption[] {
  return agents.map((a) => ({
    id: a.id,
    label: pickText(a.displayName, locale),
    altLabels: Object.values(a.displayName ?? {}).filter(Boolean),
    status: a.status,
    statusLabel: statusLabel(a.status),
  }));
}
