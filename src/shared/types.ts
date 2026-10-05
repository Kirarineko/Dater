export interface WorldDate {
  year: string;
  month: number;
  day: number;
}

export interface CalendarConfig {
  months: { name: string; days: number }[];
  weekdays: string[];
  weekdayOffset: number;
  leap: {
    kind: "gregorian" | "interval" | "none";
    interval: string;
    anchorYear: string;
    additions: { month: number; days: number }[];
    patterns: string[];
    overrides: Record<string, boolean>;
  };
}

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  leap: boolean;
}

export interface LunarConfig {
  anchor: { world: WorldDate; lunar: LunarDate } | null;
  cyclic: boolean;
}

export type InvalidDatePolicy = "skip" | "roll-forward";

export interface EventDetails {
  title: string;
  note: string;
  color: string;
  start: WorldDate;
  end: WorldDate;
  allDay: boolean;
  startTime: string;
  endTime: string;
}

export interface CalendarEvent extends EventDetails {
  id: string;
  recurrence: {
    frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
    interval: number;
    invalidDate: InvalidDatePolicy;
    until: WorldDate | null;
  };
  exceptions: {
    key: string;
    replacement: EventDetails | null;
  }[];
}

export interface Holiday {
  id: string;
  title: string;
  note: string;
  color: string;
  kind: "fixed" | "lunar";
  month: number;
  day: number;
  repeatLeap: boolean;
  invalidDate: InvalidDatePolicy;
}

export interface World {
  schemaVersion: 1;
  id: string;
  name: string;
  calendar: CalendarConfig;
  lunar: LunarConfig;
  events: CalendarEvent[];
  holidays: Holiday[];
}

export const defaultCalendar = (): CalendarConfig => ({
  months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    .map((days, i) => ({ name: `${i + 1}月`, days })),
  weekdays: ["一", "二", "三", "四", "五", "六", "日"],
  weekdayOffset: 5,
  leap: {
    kind: "gregorian", interval: "4", anchorYear: "0",
    additions: [{ month: 2, days: 1 }], patterns: [], overrides: {},
  },
});

export const formatDateNumber = (value: number): string => String(value).padStart(2, "0");

export const formatDate = (date: WorldDate): string => `${date.year}/${formatDateNumber(date.month)}/${formatDateNumber(date.day)}`;

export function parseYear(input: string): string {
  const value = input.trim();
  if (!/^[+-]?\d+$/.test(value) || value.replace(/^[+-]/, "").length > 256) {
    throw new Error("年份应为最多 256 位的整数，可为负数或 0。");
  }
  return BigInt(value).toString();
}

export function parseDate(input: string): WorldDate {
  const parts = /^([+-]?\d+)\/(\d+)\/(\d+)$/.exec(input.trim());
  if (!parts?.[1] || !parts[2] || !parts[3]) throw new Error("日期格式为 年/月/日，例如 -1/09/27。");
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (!Number.isSafeInteger(month) || !Number.isSafeInteger(day) || month < 1 || day < 1) {
    throw new Error("月份和日期应为正整数。");
  }
  return { year: parseYear(parts[1]), month, day };
}

export function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a < 0n && a % b !== 0n ? quotient - 1n : quotient;
}

export const modulo = (a: bigint, b: bigint): bigint => ((a % b) + b) % b;
