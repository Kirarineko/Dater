import { Calendar } from "./calendar.ts";
import { LunarMapping } from "./lunar.ts";
import { floorDiv, modulo } from "./types.ts";
import type { CalendarEvent, EventDetails, Holiday, WorldDate } from "./types.ts";

export interface EventOccurrence extends EventDetails {
  id: string;
  key: string;
  source: "event" | "fixed-holiday" | "lunar-holiday";
}

export function eventOccurrences(calendar: Calendar, event: CalendarEvent, from: bigint, to: bigint): EventOccurrence[] {
  const result: EventOccurrence[] = [];
  const origin = calendar.toDay(event.start);
  const duration = calendar.toDay(event.end) - origin;
  const recurrence = event.recurrence;
  const until = recurrence.until ? calendar.toDay(recurrence.until) : null;
  const interval = BigInt(recurrence.interval);
  const months = BigInt(calendar.config.months.length);
  const exceptions = new Map(event.exceptions.map(item => [item.key, item.replacement]));
  const scheduled = (index: bigint): { date: WorldDate; day: bigint; valid: boolean } => {
    if (recurrence.frequency === "daily" || recurrence.frequency === "weekly") {
      const step = interval * (recurrence.frequency === "weekly" ? BigInt(calendar.config.weekdays.length) : 1n);
      const day = origin + index * step;
      return { date: calendar.fromDay(day), day, valid: true };
    }
    const monthIndex = BigInt(event.start.month - 1) + (recurrence.frequency === "monthly" ? index * interval : 0n);
    const year = BigInt(event.start.year) + (recurrence.frequency === "yearly" ? index * interval : floorDiv(monthIndex, months));
    const month = Number(modulo(monthIndex, months)) + 1;
    const date = { year: year.toString(), month, day: event.start.day };
    const day = calendar.toDay({ ...date, day: 1 }) + BigInt(date.day - 1);
    const valid = date.day <= calendar.monthDays(year, month);
    return { date, day, valid };
  };
  const append = (details: EventDetails, index: string): void => {
    const start = calendar.toDay(details.start);
    let end = calendar.toDay(details.end);
    if (!details.allDay && details.endTime === "00:00") end--;
    if (start <= to && end >= from) result.push({ ...details, id: event.id, key: index, source: "event" });
  };
  if (recurrence.frequency === "none") {
    const replacement = exceptions.get("0");
    if (replacement !== null) append(replacement ?? event, "0");
    return result;
  }
  const threshold = from - duration;
  let low: bigint;
  if (recurrence.frequency === "daily" || recurrence.frequency === "weekly") {
    const step = interval * (recurrence.frequency === "weekly" ? BigInt(calendar.config.weekdays.length) : 1n);
    low = floorDiv(threshold - origin - 1n, step) + 1n;
  } else {
    const target = calendar.fromDay(threshold - BigInt(event.start.day - 1));
    const years = BigInt(target.year) - BigInt(event.start.year);
    const distance = recurrence.frequency === "yearly" ? years : years * months + BigInt(target.month - event.start.month);
    low = floorDiv(distance, interval);
  }
  if (low < 0n) low = 0n;
  while (scheduled(low).day < threshold) low++;
  let examined = 0;
  for (let index = low; ; index++) {
    const item = scheduled(index);
    if (item.day > to || (until !== null && item.day > until)) break;
    if (++examined > 2000) throw new Error("该日程在显示范围内超过 2000 次，请缩短跨日长度或增大重复间隔。");
    const key = index.toString();
    if (exceptions.has(key) || (!item.valid && recurrence.invalidDate === "skip")) continue;
    append({ ...event, start: item.valid ? item.date : calendar.fromDay(item.day), end: calendar.fromDay(item.day + duration) }, key);
  }
  for (const exception of event.exceptions) {
    const slot = scheduled(BigInt(exception.key));
    if (exception.replacement && (until === null || slot.day <= until)) append(exception.replacement, exception.key);
  }
  return result;
}

export function holidayOccurrences(calendar: Calendar, lunar: LunarMapping, holiday: Holiday, from: bigint, to: bigint): EventOccurrence[] {
  const result: EventOccurrence[] = [];
  const append = (day: bigint): void => {
    if (day < from || day > to) return;
    const date = calendar.fromDay(day);
    result.push({ id: holiday.id, key: day.toString(), title: holiday.title, note: holiday.note, color: holiday.color,
      start: date, end: date, allDay: true, startTime: "00:00", endTime: "23:59",
      source: holiday.kind === "lunar" ? "lunar-holiday" : "fixed-holiday" });
  };
  if (holiday.kind === "lunar") {
    for (const day of lunar.holidaysBetween(from, to, holiday.month, holiday.day, holiday.repeatLeap, holiday.invalidDate)) append(day);
  } else {
    const offset = BigInt(holiday.day - 1);
    const first = BigInt(calendar.fromDay(from - offset).year) - 1n;
    const last = BigInt(calendar.fromDay(to - offset).year) + 1n;
    if (last - first > 2000n) throw new Error("节日查询跨越过多年份，请缩小显示范围。");
    for (let year = first; year <= last; year++) {
      const days = calendar.monthDays(year, holiday.month);
      if (holiday.day > days && holiday.invalidDate === "skip") continue;
      append(calendar.toDay({ year: year.toString(), month: holiday.month, day: 1 }) + offset);
    }
  }
  return result.sort((a, b) => calendar.toDay(a.start) < calendar.toDay(b.start) ? -1 : 1);
}
