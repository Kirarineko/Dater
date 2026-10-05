import { floorDiv, modulo } from "./types.ts";
import type { CalendarConfig, WorldDate } from "./types.ts";
import { YearPatterns } from "./year-pattern.ts";

export class Calendar {
  readonly ordinaryYearDays: bigint;
  readonly leapDays: bigint;
  private readonly patterns: YearPatterns | null;
  private readonly starts = new Map<string, bigint>();

  constructor(readonly config: CalendarConfig) {
    this.ordinaryYearDays = config.months.reduce((sum, month) => sum + BigInt(month.days), 0n);
    this.leapDays = config.leap.additions.reduce((sum, item) => sum + BigInt(item.days), 0n);
    if (this.ordinaryYearDays < 1n) throw new Error("一年至少需要一天。");
    if (config.leap.patterns.length && config.leap.kind === "interval" && BigInt(config.leap.interval) > 400n) {
      throw new Error("同时使用正则时，固定闰年间隔最多为 400；移除正则后间隔不受此限制。");
    }
    this.patterns = config.leap.patterns.length ? new YearPatterns(config.leap.patterns) : null;
    this.patterns?.validateComplexity(config.leap.kind === "gregorian" ? 400 : config.leap.kind === "interval" ? Number(config.leap.interval) : 1);
  }

  private baseLeap(year: bigint): boolean {
    const leap = this.config.leap;
    if (leap.kind === "none") return false;
    if (leap.kind === "gregorian") return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
    return modulo(year - BigInt(leap.anchorYear), BigInt(leap.interval)) === 0n;
  }

  isLeap(year: bigint): boolean {
    return this.config.leap.overrides[year.toString()] ?? (this.patterns?.matches(year) || this.baseLeap(year));
  }

  private baseCount(a: bigint, b: bigint): bigint {
    const multiples = (interval: bigint, anchor = 0n): bigint =>
      floorDiv(b - 1n - anchor, interval) - floorDiv(a - 1n - anchor, interval);
    const leap = this.config.leap;
    if (leap.kind === "none") return 0n;
    if (leap.kind === "gregorian") return multiples(4n) - multiples(100n) + multiples(400n);
    return multiples(BigInt(leap.interval), BigInt(leap.anchorYear));
  }

  private leapCount(a: bigint, b: bigint): bigint {
    if (a >= b) return 0n;
    let total = this.baseCount(a, b);
    if (this.patterns) {
      const modulus = this.config.leap.kind === "gregorian" ? 400 :
        this.config.leap.kind === "interval" ? Number(this.config.leap.interval) : 1;
      const count = (bound: bigint, negative: boolean): bigint =>
        this.patterns?.count(bound, negative, modulus, remainder => this.baseLeap(BigInt(negative ? -remainder : remainder))) ?? 0n;
      if (a < 0n) total += count(-a, true) - count(b < 0n ? -b : 0n, true);
      if (b > 0n) total += count(b - 1n, false) - count(a > 0n ? a - 1n : -1n, false);
    }
    for (const [text, forced] of Object.entries(this.config.leap.overrides)) {
      const year = BigInt(text);
      if (year >= a && year < b) {
        const regular = this.patterns?.matches(year) || this.baseLeap(year);
        total += BigInt(Number(forced) - Number(regular));
      }
    }
    return total;
  }

  yearStart(year: bigint): bigint {
    const key = year.toString();
    const cached = this.starts.get(key);
    if (cached !== undefined) return cached;
    const leaps = year >= 0n ? this.leapCount(0n, year) : -this.leapCount(year, 0n);
    const start = year * this.ordinaryYearDays + leaps * this.leapDays;
    if (this.starts.size > 2048) this.starts.clear();
    this.starts.set(key, start);
    return start;
  }

  monthDays(year: bigint, month: number): number {
    const item = this.config.months[month - 1];
    if (!item) throw new Error("月份超出当前历法范围。");
    return item.days + (this.isLeap(year) ? this.config.leap.additions
      .filter(addition => addition.month === month).reduce((sum, addition) => sum + addition.days, 0) : 0);
  }

  yearDays(year: bigint): bigint { return this.ordinaryYearDays + (this.isLeap(year) ? this.leapDays : 0n); }

  validate(date: WorldDate): void {
    if (!/^(?:0|-?[1-9]\d*)$/.test(date.year)) throw new Error("年份须为规范十进制整数。");
    if (!Number.isSafeInteger(date.month) || !Number.isSafeInteger(date.day) || date.day < 1 ||
      date.day > this.monthDays(BigInt(date.year), date.month)) throw new Error("日期不存在于当前历法中。");
  }

  toDay(date: WorldDate): bigint {
    this.validate(date);
    let day = this.yearStart(BigInt(date.year));
    for (let month = 1; month < date.month; month++) day += BigInt(this.monthDays(BigInt(date.year), month));
    return day + BigInt(date.day - 1);
  }

  fromDay(day: bigint): WorldDate {
    const longest = this.ordinaryYearDays + this.leapDays;
    let low = day >= 0n ? floorDiv(day, longest) : floorDiv(day, this.ordinaryYearDays) - 1n;
    let high = (day >= 0n ? floorDiv(day, this.ordinaryYearDays) : floorDiv(day, longest)) + 1n;
    let lowDay = this.yearStart(low);
    let highDay = this.yearStart(high);
    let iteration = 0;
    while (high - low > 1n) {
      // Interpolation is fast for large spans; regular bisection guarantees
      // progress when a pattern creates irregular runs of leap years.
      let year = iteration++ % 8 === 7 ? floorDiv(low + high, 2n) :
        low + (day - lowDay) * (high - low) / (highDay - lowDay);
      if (year <= low) year = low + 1n;
      if (year >= high) year = high - 1n;
      const start = this.yearStart(year);
      if (start <= day) { low = year; lowDay = start; }
      else { high = year; highDay = start; }
    }
    let offset = day - lowDay;
    for (let month = 1; month <= this.config.months.length; month++) {
      const length = BigInt(this.monthDays(low, month));
      if (offset < length) return { year: low.toString(), month, day: Number(offset) + 1 };
      offset -= length;
    }
    throw new Error("无法定位连续日序号。");
  }

  rollForward(date: WorldDate): WorldDate {
    const count = BigInt(this.config.months.length);
    const index = BigInt(date.month - 1);
    const year = BigInt(date.year) + floorDiv(index, count);
    const month = Number(modulo(index, count)) + 1;
    return this.fromDay(this.toDay({ year: year.toString(), month, day: 1 }) + BigInt(date.day - 1));
  }

  weekday(date: WorldDate): number { return Number(modulo(this.toDay(date) + BigInt(this.config.weekdayOffset), BigInt(this.config.weekdays.length))); }
}
