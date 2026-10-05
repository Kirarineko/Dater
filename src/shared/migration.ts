import { Calendar } from "./calendar.ts";
import { eventOccurrences, holidayOccurrences } from "./events.ts";
import { LunarMapping } from "./lunar.ts";
import { formatDate, formatDateNumber } from "./types.ts";
import type { CalendarConfig, EventDetails, LunarConfig, World, WorldDate } from "./types.ts";
import { validateWorld } from "./validation.ts";

export function previewMigration(world: World, config: CalendarConfig, lunarConfig: LunarConfig,
  reference: WorldDate = { year: "1", month: 1, day: 1 }): { world: World; changes: string[] } {
  const previous = new Calendar(world.calendar);
  const calendar = new Calendar(config);
  const changes: string[] = [];
  const migrate = (details: EventDetails, label: string): EventDetails => {
    const start = calendar.rollForward(details.start);
    const end = calendar.rollForward(details.end);
    if (calendar.toDay(end) < calendar.toDay(start) || (calendar.toDay(end) === calendar.toDay(start) &&
      !details.allDay && details.endTime <= details.startTime)) {
      throw new Error(`「${label}」在新历法中结束早于开始：${formatDate(start)}–${formatDate(end)}。请先调整此日程，再修改月份数量。`);
    }
    if (formatDate(start) !== formatDate(details.start) || formatDate(end) !== formatDate(details.end)) {
      changes.push(`${label}：${formatDate(details.start)}–${formatDate(details.end)} → ${formatDate(start)}–${formatDate(end)}`);
    }
    return { ...details, start, end };
  };
  const next: World = { ...world, calendar: config, lunar: lunarConfig,
    events: world.events.map(event => {
      const details = migrate(event, event.title);
      const until = event.recurrence.until ? calendar.rollForward(event.recurrence.until) : null;
      if (until && calendar.toDay(until) < calendar.toDay(details.start)) {
        throw new Error(`「${event.title}」的新重复截止日期早于开始日期，请先调整此日程。`);
      }
      if (until && event.recurrence.until && formatDate(until) !== formatDate(event.recurrence.until)) {
        changes.push(`${event.title} · 重复截止：${formatDate(event.recurrence.until)} → ${formatDate(until)}`);
      }
      return { ...event, ...details, recurrence: { ...event.recurrence, until },
        exceptions: event.exceptions.map(exception => ({ ...exception,
          replacement: exception.replacement ? migrate(exception.replacement, `${event.title} · 单次修改`) : null })) };
    }),
    holidays: world.holidays.map(holiday => {
      if (holiday.kind === "fixed" && holiday.month > config.months.length) {
        const month = (holiday.month - 1) % config.months.length + 1;
        changes.push(`${holiday.title}（固定节日规则）：${formatDateNumber(holiday.month)}/${formatDateNumber(holiday.day)} → ${formatDateNumber(month)}/${formatDateNumber(holiday.day)}；各年继续使用原跳过 / 顺延选项。`);
        return { ...holiday, month };
      }
      return holiday;
    }) };
  if (next.lunar.anchor) {
    const anchor = next.lunar.anchor;
    const migrated = calendar.rollForward(anchor.world);
    if (formatDate(migrated) !== formatDate(anchor.world)) changes.push(`农历世界观基准：${formatDate(anchor.world)} → ${formatDate(migrated)}`);
    next.lunar = { ...next.lunar, anchor: { ...anchor, world: migrated } };
  }
  const oldReference = previous.rollForward(reference);
  const newReference = calendar.rollForward(reference);
  const oldDay = previous.toDay(oldReference);
  const newDay = calendar.toDay(newReference);
  changes.unshift(`月份 ${world.calendar.months.length} → ${config.months.length}；平年 ${previous.ordinaryYearDays} → ${calendar.ordinaryYearDays} 天；每闰年增加 ${previous.leapDays} → ${calendar.leapDays} 天。`);
  if (JSON.stringify(world.calendar.weekdays) !== JSON.stringify(config.weekdays) || world.calendar.weekdayOffset !== config.weekdayOffset) {
    changes.push(`星期：${world.calendar.weekdays.join("、")} → ${config.weekdays.join("、")}；${formatDate(newReference)} 的星期 ${world.calendar.weekdays[previous.weekday(oldReference)]} → ${config.weekdays[calendar.weekday(newReference)]}。`);
  }
  const sampleYear = BigInt(reference.year);
  changes.push(`闰年命中预览：${[-2n, -1n, 0n, 1n, 2n].map(offset => {
    const year = sampleYear + offset;
    return `${year}年 ${previous.isLeap(year) ? "闰" : "平"}→${calendar.isLeap(year) ? "闰" : "平"}`;
  }).join("；")}。`);
  for (const event of world.events.filter(event => event.recurrence.frequency !== "none")) {
    const updated = next.events.find(item => item.id === event.id);
    if (!updated) continue;
    try {
      const before = new Map(eventOccurrences(previous, event, oldDay, oldDay + 59n).map(item => [item.key, `${formatDate(item.start)}–${formatDate(item.end)}`]));
      const after = new Map(eventOccurrences(calendar, updated, newDay, newDay + 59n).map(item => [item.key, `${formatDate(item.start)}–${formatDate(item.end)}`]));
      const keys = new Set([...before.keys(), ...after.keys()]);
      const modified = [...keys].filter(key => before.get(key) !== after.get(key));
      for (const key of modified.slice(0, 8)) {
        changes.push(`${event.title} · 第 ${BigInt(key) + 1n} 次：${before.get(key) ?? "预览内不出现"} → ${after.get(key) ?? "预览内不出现"}`);
      }
      if (modified.length > 8) changes.push(`${event.title}：预览内另外 ${modified.length - 8} 次日期变化。`);
    } catch (error) {
      changes.push(`${event.title}：重复预览未能列出（${error instanceof Error ? error.message : String(error)}），请先缩短跨日长度。`);
    }
  }
  const oldLunar = new LunarMapping(previous, world.lunar);
  const newLunar = new LunarMapping(calendar, next.lunar);
  if (world.lunar.anchor || next.lunar.anchor) {
    changes.push(`农历对照 ${formatDate(newReference)}：${oldLunar.label(oldReference)} → ${newLunar.label(newReference)}`);
    if (world.lunar.cyclic !== next.lunar.cyclic) changes.push(`循环农历：${world.lunar.cyclic ? "开启" : "关闭"} → ${next.lunar.cyclic ? "开启" : "关闭"}。`);
  }
  for (const holiday of world.holidays) {
    const updated = next.holidays.find(item => item.id === holiday.id);
    if (!updated) continue;
    const before = holidayOccurrences(previous, oldLunar, holiday, oldDay, oldDay + 399n).map(item => formatDate(item.start));
    const after = holidayOccurrences(calendar, newLunar, updated, newDay, newDay + 399n).map(item => formatDate(item.start));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const label = (dates: string[]): string => dates.length ? dates.slice(0, 8).join("、") + (dates.length > 8 ? ` 等 ${dates.length} 次` : "") : "预览内不出现";
      changes.push(`${holiday.title}（节日，400 天预览）：${label(before)} → ${label(after)}`);
    }
  }
  return { world: validateWorld(next), changes };
}
