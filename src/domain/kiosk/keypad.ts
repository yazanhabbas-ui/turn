/** On-screen numeric keypad logic for the kiosk phone field. Digits are kept Western internally; display converts. */

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "back" | "clear";

export const KEYPAD_LAYOUT: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export const PHONE_MAX_DIGITS = 15;

export function pressKey(value: string, key: KeypadKey, max = PHONE_MAX_DIGITS): string {
  if (key === "clear") return "";
  if (key === "back") return value.slice(0, -1);
  return value.length >= max ? value : value + key;
}

/** Groups a phone number for reading: 0944123456 -> "094 412 3456"-style blocks of 3 (last block up to 4). */
export function groupDigits(value: string): string {
  const parts: string[] = [];
  let rest = value;
  while (rest.length > 4) {
    parts.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  if (rest) parts.push(rest);
  return parts.join(" ");
}
