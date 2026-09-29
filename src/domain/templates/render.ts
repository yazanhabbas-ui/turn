/** Placeholders use `{name}`. Unknown placeholders are left untouched so missing data is visible, not silent. */
const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

export function placeholdersOf(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Masks a phone or email for logs: +9665****1234, k****@example.com. */
export function maskRecipient(value: string): string {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 1)}****@${domain}`;
  }
  const digits = value.replace(/\s/g, "");
  return digits.length <= 6 ? "****" : `${digits.slice(0, 5)}****${digits.slice(-4)}`;
}
