import { Lunar, LunarYear } from "lunar-typescript";
import { Calendar } from "./calendar.ts";
import { modulo } from "./types.ts";
import type { LunarConfig, LunarDate, WorldDate } from "./types.ts";

export const LUNAR_FIRST_YEAR = 1900;
export const LUNAR_LAST_YEAR = 2100;
interface Month { year: number; month: number; leap: boolean; days: number; start: bigint }
export interface LunarResult extends LunarDate { cyclic: boolean; cycleYear: number; cycle: bigint }
export interface LunarDisplay {
  dateLabel: string;
  solarTerm: string | null;
  festivals: string[];
}
let cachedMonths: Month[] | undefined;

function months(): Month[] {
  if (cachedMonths) return cachedMonths;
  const result: Month[] = [];
  let start = 0n;
  for (let year = LUNAR_FIRST_YEAR; year <= LUNAR_LAST_YEAR; year++) {
    for (const month of LunarYear.fromYear(year).getMonthsInYear()) {
      result.push({ year, month: Math.abs(month.getMonth()), leap: month.getMonth() < 0,
        days: month.getDayCount(), start });
      start += BigInt(month.getDayCount());
    }
  }
  cachedMonths = result;
  return result;
}

export class LunarMapping {
  private readonly data = months();
  readonly totalDays: bigint;
  private readonly origin: bigint | null;

  constructor(readonly calendar: Calendar, readonly config: LunarConfig) {
    const last = this.data.at(-1);
    if (!last) throw new Error("农历数据为空。");
    this.totalDays = last.start + BigInt(last.days);
    this.origin = config.anchor ? this.lunarDay(config.anchor.lunar) - calendar.toDay(config.anchor.world) : null;
  }

  lunarDay(date: LunarDate): bigint {
    const month = this.data.find(item => item.year === date.year && item.month === date.month && item.leap === date.leap);
    if (!month || date.day < 1 || date.day > month.days) {
      throw new Error(`农历基准须为 ${LUNAR_FIRST_YEAR}–${LUNAR_LAST_YEAR} 范围内存在的日期，请检查闰月和天数。`);
    }
    return month.start + BigInt(date.day - 1);
  }

  at(date: WorldDate): LunarResult | null {
    return this.atDay(this.calendar.toDay(date));
  }

  atDay(day: bigint): LunarResult | null {
    if (this.origin === null) return null;
    const raw = day + this.origin;
    const cyclic = raw < 0n || raw >= this.totalDays;
    if (cyclic && !this.config.cyclic) return null;
    const index = cyclic ? modulo(raw, this.totalDays) : raw;
    let low = 0;
    let high = this.data.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.data[middle]?.start ?? 0n) <= index) low = middle;
      else high = middle;
    }
    const month = this.data[low];
    if (!month) throw new Error("农历日序号无效。");
    return { year: month.year, month: month.month, day: Number(index - month.start) + 1, leap: month.leap,
      cyclic, cycleYear: month.year - LUNAR_FIRST_YEAR + 1, cycle: (raw - index) / this.totalDays };
  }

  describe(date: WorldDate): LunarDisplay | null {
    const value = this.at(date);
    if (!value) return null;
    // Use the mapped sample day for every annotation, including cyclic results.
    const lunar = Lunar.fromYmd(value.year, value.leap ? -value.month : value.month, value.day);
    const dateLabel = `${lunar.getYearInGanZhi()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
    return {
      dateLabel: value.cyclic ? `循环农历 · 第${value.cycleYear}年 · ${dateLabel}` : dateLabel,
      solarTerm: lunar.getJieQi() || null,
      festivals: [...new Set([...lunar.getFestivals(), ...lunar.getOtherFestivals()])],
    };
  }

  label(date: WorldDate): string {
    if (!this.config.anchor) return "农历未设置基准";
    return this.describe(date)?.dateLabel ?? "农历不可用";
  }

  holidaysBetween(from: bigint, to: bigint, month: number, day: number, repeatLeap: boolean,
    invalid: "skip" | "roll-forward"): bigint[] {
    if (this.origin === null) return [];
    const result: bigint[] = [];
    const cycleStart = this.config.cyclic ? (from + this.origin - modulo(from + this.origin, this.totalDays)) / this.totalDays - 1n : 0n;
    const cycleEnd = this.config.cyclic ? (to + this.origin - modulo(to + this.origin, this.totalDays)) / this.totalDays : 0n;
    if (cycleEnd - cycleStart > 4n) throw new Error("当前节日查询跨度过大，请缩小显示范围。");
    for (let cycle = cycleStart; cycle <= cycleEnd; cycle++) {
      for (const item of this.data) {
        if (item.month !== month || (item.leap && !repeatLeap) || (day > item.days && invalid === "skip")) continue;
        const sample = item.start + BigInt(day - 1);
        // A rolled date can cross the last complete sample year boundary.
        const raw = sample + cycle * this.totalDays;
        if (!this.config.cyclic && (raw < 0n || raw >= this.totalDays)) continue;
        const worldDay = raw - this.origin;
        if (worldDay >= from && worldDay <= to) result.push(worldDay);
      }
    }
    return result;
  }
}
