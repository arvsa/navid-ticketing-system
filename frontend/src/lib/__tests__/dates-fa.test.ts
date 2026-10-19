// Dates in Farsi with the Persian calendar. Language and calendar are read at
// module load, so the modules are loaded fresh with a stubbed localStorage.
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(settings: Record<string, string>) {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: (k: string) => settings[k] ?? null, setItem: () => {} });
  return import("../dates");
}

afterEach(() => vi.unstubAllGlobals());

describe("dates in Farsi, Persian calendar", () => {
  it("formats days, times and months", async () => {
    const d = await load({ "st.lang": "fa", "st.calendar": "persian" });
    // Saturday 24 October 2026, 17:30 in Tehran = 2 Aban 1405.
    expect(d.formatDay("2026-10-24T14:00:00Z", "Asia/Tehran")).toBe("شنبه ۲ آبان");
    expect(d.formatDateTime("2026-10-24T14:00:00Z", "Asia/Tehran")).toBe("شنبه ۲ آبان، ۱۷:۳۰");
    expect(d.formatMonthTitle({ y: 1405, m: 8 })).toBe("آبان ۱۴۰۵");
    // List items are wrapped in invisible direction isolates.
    expect(d.describeReminders([1440, 60])).toBe("⁨۱ روز⁩ و ⁨۱ ساعت⁩");
  });

  it("builds Jalali month grids that start on Saturday", async () => {
    const d = await load({ "st.lang": "fa", "st.calendar": "persian" });
    expect(d.weekStartsOn).toBe(6);
    expect(d.weekdayHeadings()[0]).toBe("شنبه");
    const aban = { y: 1405, m: 8 };
    expect(d.daysInMonth(aban)).toBe(30);
    expect(d.dateIn(aban, 1)).toEqual(new Date(2026, 9, 23));
    expect(d.addMonthsTo({ y: 1405, m: 12 }, 1)).toEqual({ y: 1406, m: 1 });
    // A Gregorian link opens the Jalali month holding its first day.
    expect(d.parseMonthParam("2026-10")).toEqual({ y: 1405, m: 7 });
    expect(d.parseMonthParam("1405-08")).toEqual(aban);
  });

  it("keeps English Gregorian output unchanged", async () => {
    const d = await load({ "st.lang": "en", "st.calendar": "gregorian" });
    expect(d.formatDateTime("2026-10-24T14:00:00Z", "Europe/London")).toBe("Sat 24 Oct, 15:00");
    expect(d.weekStartsOn).toBe(1);
    expect(d.parseMonthParam("1405-08")).toEqual({ y: 2026, m: 10 });
  });
});
