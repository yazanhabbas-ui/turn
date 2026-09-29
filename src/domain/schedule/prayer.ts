import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
import { zonedParts } from "./time";

export type Prayer = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

/**
 * Prayer times computed fully offline (astronomical calculation, Umm al-Qura method by default).
 * Returns local minutes-since-midnight in the branch time zone.
 */
export function prayerMinutes(
  date: string,
  tz: string,
  lat: number,
  lng: number,
  method: keyof typeof CalculationMethod = "UmmAlQura",
): Record<Prayer, number> {
  const [y, m, d] = date.split("-").map(Number);
  const params = (CalculationMethod[method] as () => ReturnType<typeof CalculationMethod.UmmAlQura>)();
  // adhan uses the calendar date of the Date object; noon UTC keeps the date stable for any time zone.
  const times = new PrayerTimes(new Coordinates(lat, lng), new Date(Date.UTC(y, m - 1, d, 12)), params);
  const local = (t: Date) => zonedParts(t, tz).minutes;
  return {
    fajr: local(times.fajr),
    dhuhr: local(times.dhuhr),
    asr: local(times.asr),
    maghrib: local(times.maghrib),
    isha: local(times.isha),
  };
}
