export type DigitSystem = "latn" | "arab";

const EASTERN = "٠١٢٣٤٥٦٧٨٩";

/** Converts Eastern Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Western 0-9. */
export function toWesternDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Converts Western digits to Eastern Arabic-Indic digits. */
export function toEasternDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => EASTERN[Number(d)]);
}

export function applyDigits(input: string, system: DigitSystem): string {
  return system === "arab" ? toEasternDigits(input) : toWesternDigits(input);
}

/** Formats a ticket number: prefix + separator + zero-padded number, in the chosen digit system. */
export function formatTicketNumber(
  prefix: string,
  number: number,
  opts: { pad?: number; separator?: string; digits?: DigitSystem } = {},
): string {
  const { pad = 3, separator = "-", digits = "latn" } = opts;
  const body = applyDigits(String(number).padStart(pad, "0"), digits);
  return prefix ? `${prefix}${separator}${body}` : body;
}
