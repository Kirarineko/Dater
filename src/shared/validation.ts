import { Calendar } from "./calendar.ts";
import { LunarMapping } from "./lunar.ts";
import { parseYear } from "./types.ts";
import type { CalendarConfig, CalendarEvent, EventDetails, Holiday, InvalidDatePolicy, LunarConfig, World, WorldDate } from "./types.ts";

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name}须为对象。`);
  return value as Record<string, unknown>;
}
function array(value: unknown, name: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name}须为数组，最多 ${max} 项。`);
  return value as unknown[];
}
function string(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
    throw new Error(`${name}须为文本，最多 ${max} 个字符，不能包含终端控制字符。`);
  }
  return value;
}
function title(value: unknown, name: string): string {
  const result = string(value, name, 160).trim();
  if (!result || /[\r\n\t]/.test(result)) throw new Error(`${name}不能为空或包含换行与制表符。`);
  return result;
}
function integer(value: unknown, name: string, min = 1, max = 1_000_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}须为 ${min}–${max} 的整数。`);
  }
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name}须为布尔值。`);
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${name}选项无效。`);
  return value as T;
}
function year(value: unknown): string {
  const text = string(value, "年份", 257);
  const result = parseYear(text);
  if (result !== text) throw new Error("JSON 年份须为规范十进制字符串，不包含前导零或正号。");
  return result;
}
function id(value: unknown): string {
  const text = string(value, "标识", 80);
  if (!/^[a-zA-Z0-9-]+$/.test(text)) throw new Error("数据标识只能包含字母、数字与连字符。");
  return text;
}
function date(value: unknown): WorldDate {
  const item = object(value, "日期");
  return { year: year(item.year), month: integer(item.month, "月份", 1, 128), day: integer(item.day, "日期") };
}
function color(value: unknown): string {
  const text = string(value, "颜色", 7);
  if (!/^#[\da-f]{6}$/i.test(text)) throw new Error("颜色格式须为 #RRGGBB。");
  return text;
}
function time(value: unknown): string {
  const text = string(value, "时间", 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("时间格式须为 00:00–23:59。");
  return text;
}
function policy(value: unknown): InvalidDatePolicy {
  return choice(value, ["skip", "roll-forward"], "无效日期处理");
}

export function validateCalendar(value: unknown): CalendarConfig {
  const item = object(value, "历法");
  const leap = object(item.leap, "闰年规则");
  const overrides = object(leap.overrides, "单年覆盖");
  if (Object.keys(overrides).length > 10000) throw new Error("单年覆盖最多 10000 项。");
  const result: CalendarConfig = {
    months: array(item.months, "月份", 128).map(entry => {
      const month = object(entry, "月份");
      return { name: title(month.name, "月份名称"), days: integer(month.days, "月份天数") };
    }),
    weekdays: array(item.weekdays, "星期", 64).map(value => title(value, "星期名称")),
    weekdayOffset: item.weekdayOffset === undefined ? 5 : integer(item.weekdayOffset, "星期基准", 0, 63),
    leap: {
      kind: choice(leap.kind, ["gregorian", "interval", "none"], "基础闰年规则"),
      interval: year(leap.interval), anchorYear: year(leap.anchorYear),
      additions: array(leap.additions, "闰日分配", 128).map(entry => {
        const addition = object(entry, "闰日分配");
        return { month: integer(addition.month, "闰日月份", 1, 128), days: integer(addition.days, "增加天数") };
      }),
      patterns: array(leap.patterns, "正则规则", 8).map(value => string(value, "正则", 160)),
      overrides: Object.fromEntries(Object.entries(overrides).map(([key, value]) => [year(key), boolean(value, "单年覆盖")])),
    },
  };
  if (!result.months.length || !result.weekdays.length) throw new Error("月份和星期至少各有一项。");
  if (result.weekdayOffset >= result.weekdays.length) throw new Error("星期基准超出星期数量。");
  if (BigInt(result.leap.interval) < 1n) throw new Error("闰年间隔须大于 0。");
  const allocated = new Set<number>();
  for (const addition of result.leap.additions) {
    if (addition.month > result.months.length || allocated.has(addition.month)) throw new Error("闰日月份不存在或重复。");
    allocated.add(addition.month);
    if ((result.months[addition.month - 1]?.days ?? 0) + addition.days > 1_000_000_000) throw new Error("闰年月份最多十亿天。");
  }
  new Calendar(result);
  return result;
}

export function validateLunar(value: unknown, calendar: Calendar): LunarConfig {
  const item = object(value, "农历设置");
  let anchor: LunarConfig["anchor"] = null;
  if (item.anchor !== null) {
    const input = object(item.anchor, "农历基准");
    const lunar = object(input.lunar, "现实农历日期");
    anchor = { world: date(input.world), lunar: {
      year: integer(lunar.year, "农历年份", 1900, 2100), month: integer(lunar.month, "农历月份", 1, 12),
      day: integer(lunar.day, "农历日期", 1, 30), leap: boolean(lunar.leap, "农历闰月"),
    } };
  }
  const result = { anchor, cyclic: boolean(item.cyclic, "循环农历") };
  if (anchor) new LunarMapping(calendar, result);
  return result;
}

export function validateDetails(value: unknown, calendar: Calendar): EventDetails {
  const item = object(value, "日程");
  const result: EventDetails = {
    title: title(item.title, "日程标题"), note: string(item.note, "备注", 10000), color: color(item.color),
    start: date(item.start), end: date(item.end), allDay: boolean(item.allDay, "全天"),
    startTime: time(item.startTime), endTime: time(item.endTime),
  };
  const begin = calendar.toDay(result.start);
  const end = calendar.toDay(result.end);
  if (end < begin || (end === begin && !result.allDay && result.endTime <= result.startTime)) {
    throw new Error("结束日期或时间须晚于开始；全天日程允许同一天。");
  }
  return result;
}

export function validateEvent(value: unknown, calendar: Calendar): CalendarEvent {
  const item = object(value, "日程");
  const recurrence = object(item.recurrence, "重复规则");
  const result: CalendarEvent = {
    ...validateDetails(item, calendar), id: id(item.id),
    recurrence: {
      frequency: choice(recurrence.frequency, ["none", "daily", "weekly", "monthly", "yearly"], "重复频率"),
      interval: integer(recurrence.interval, "重复间隔"), invalidDate: policy(recurrence.invalidDate),
      until: recurrence.until === null ? null : date(recurrence.until),
    },
    exceptions: array(item.exceptions, "单次例外").map(value => {
      const exception = object(value, "单次例外");
      const key = string(exception.key, "单次序号", 512);
      if (!/^(?:0|[1-9]\d*)$/.test(key)) throw new Error("日程单次序号须为非负的规范十进制整数。");
      return { key, replacement: exception.replacement === null ? null : validateDetails(exception.replacement, calendar) };
    }),
  };
  if (new Set(result.exceptions.map(item => item.key)).size !== result.exceptions.length) throw new Error("单次例外序号重复。");
  if (result.recurrence.until && calendar.toDay(result.recurrence.until) < calendar.toDay(result.start)) {
    throw new Error("重复截止日期不能早于日程开始日期。");
  }
  return result;
}

export function validateHoliday(value: unknown, calendar: Calendar): Holiday {
  const item = object(value, "节日");
  const kind = choice(item.kind, ["fixed", "lunar"], "节日类型");
  return { id: id(item.id), title: title(item.title, "节日标题"), note: string(item.note, "备注", 10000),
    color: color(item.color), kind, month: integer(item.month, "节日月份", 1, kind === "lunar" ? 12 : calendar.config.months.length),
    day: integer(item.day, "节日日期", 1, kind === "lunar" ? 30 : 1_000_000_000),
    repeatLeap: boolean(item.repeatLeap, "闰月重复"), invalidDate: policy(item.invalidDate) };
}

export function validateWorld(value: unknown): World {
  const item = object(value, "世界观文件");
  if (item.schemaVersion !== 1) throw new Error("不支持此文件格式版本；没有修改原文件。");
  const config = validateCalendar(item.calendar);
  const calendar = new Calendar(config);
  const world: World = { schemaVersion: 1, id: id(item.id), name: title(item.name, "世界观名称"), calendar: config,
    lunar: validateLunar(item.lunar, calendar),
    events: array(item.events, "日程").map(value => validateEvent(value, calendar)),
    holidays: array(item.holidays, "节日").map(value => validateHoliday(value, calendar)) };
  const ids = [...world.events, ...world.holidays].map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("日程或节日标识重复。");
  return world;
}
