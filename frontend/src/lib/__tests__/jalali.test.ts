import { describe, expect, it } from "vitest";
import { jalaliMonthLength, toGregorian, toJalali } from "../jalali";

const intl = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
const viaIntl = (d: Date) => {
  const p = Object.fromEntries(intl.formatToParts(d).map((x) => [x.type, x.value]));
  return { jy: parseInt(p.year), jm: +p.month, jd: +p.day };
};

describe("jalali", () => {
  it("knows Nowruz", () => {
    expect(toJalali(2026, 3, 21)).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(toGregorian(1405, 7, 26)).toEqual({ gy: 2026, gm: 10, gd: 18 });
  });
  it("matches Intl's Persian calendar for every day from 2000 to 2060", () => {
    for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2060, 0, 1); t += 86_400_000) {
      const d = new Date(t);
      const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      expect(j).toEqual(viaIntl(d));
      expect(toGregorian(j.jy, j.jm, j.jd)).toEqual({ gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() });
      expect(j.jd).toBeLessThanOrEqual(jalaliMonthLength(j.jy, j.jm));
    }
  });
});
