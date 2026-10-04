/**
 * The admin sidebar lists the settings sections under "Settings". Choosing one while the settings page is open must go
 * through the page's unsaved-edits guard, so the sidebar announces it with this event; the page marks it `handled`.
 * When nobody handles it (another admin page is open), the sidebar navigates to the settings page itself.
 */
export const SETTINGS_GO = "dor:settings-go";
export type SettingsGoDetail = { id: string; handled?: boolean };

/** The settings page tells the sidebar which section is open (the address changes without a navigation). */
export const SETTINGS_ACTIVE = "dor:settings-active";
