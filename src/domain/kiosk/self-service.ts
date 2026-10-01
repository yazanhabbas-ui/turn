/**
 * What a visitor may do alone at a self check-in kiosk (D61). Pure rules shared by the server (which enforces them)
 * and the kiosk screen (which uses them to decide what to show).
 */

export type KioskField = { key: string; required: boolean; selfService?: boolean };
export type KioskReasonLike = { requiresStaff?: boolean; intakeFields: readonly KioskField[] };

/** Built-in fields a visitor may type themselves unless the reason says otherwise. Sensitive and custom fields are staff-only by default. */
const SELF_SERVICE_BY_DEFAULT = new Set(["name", "phone", "company", "email", "notes"]);

export function fieldSelfService(f: KioskField): boolean {
  return f.selfService ?? SELF_SERVICE_BY_DEFAULT.has(f.key);
}

/** The fields the kiosk shows for a reason: the ones a visitor may enter alone. */
export function kioskFields<F extends KioskField>(r: { intakeFields: readonly F[] }): F[] {
  return r.intakeFields.filter(fieldSelfService);
}

/**
 * `available`: the visitor can get a ticket alone. `ask_staff`: the reason is marked "requires staff" or has a
 * required field a visitor may not enter alone, so the kiosk shows it as "please ask the agent".
 */
export function kioskReasonState(r: KioskReasonLike): "available" | "ask_staff" {
  if (r.requiresStaff) return "ask_staff";
  return r.intakeFields.some((f) => f.required && !fieldSelfService(f)) ? "ask_staff" : "available";
}

/** Reasons offered on a kiosk, honouring the branch's "allowed reasons" list (empty = every self-service reason). */
export function kioskAllows(allowedReasonIds: readonly string[], reasonId: string): boolean {
  return allowedReasonIds.length === 0 || allowedReasonIds.includes(reasonId);
}
