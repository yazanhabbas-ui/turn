/**
 * Message templates exist once for the organization (`cityId` null) and may be overridden per city (D60). Given every
 * row stored for one channel and event, a branch's city own template wins, otherwise the organization's applies.
 */
export function pickByCity<T extends { cityId: string | null }>(
  rows: readonly T[],
  cityId: string | null | undefined,
): T | undefined {
  return (cityId ? rows.find((r) => r.cityId === cityId) : undefined) ?? rows.find((r) => r.cityId === null);
}
