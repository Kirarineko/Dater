import { randomUUID } from "node:crypto";
import { BoxRenderable, InputRenderable, MouseButton, SelectRenderable, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent, MouseEvent } from "@opentui/core";
import { Calendar } from "../shared/calendar.ts";
import { eventOccurrences, holidayOccurrences } from "../shared/events.ts";
import type { EventOccurrence } from "../shared/events.ts";
import { LunarMapping } from "../shared/lunar.ts";
import { previewMigration } from "../shared/migration.ts";
import { defaultCalendar, formatDate, formatDateNumber, parseDate, parseYear } from "../shared/types.ts";
import type { CalendarConfig, CalendarEvent, EventDetails, Holiday, LunarConfig, World, WorldDate } from "../shared/types.ts";
import { validateCalendar, validateDetails, validateEvent, validateHoliday, validateLunar, validateWorld } from "../shared/validation.ts";
import { WorldStore } from "../storage/world-store.ts";
import { clip, confirmationDialog, formDialog, informationDialog, menuDialog } from "./dialogs.ts";
import type { Dialog, FormField } from "./dialogs.ts";

const colors = { bg: "#101923", panel: "#172335", text: "#e4edf7", muted: "#9cafc5", accent: "#7edbc1", selected: "#365773" };
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
const value = (values: Record<string, string>, field: string): string => values[field]?.trim() ?? "";
function yes(text: string): boolean {
  if (["是", "yes", "true", "1"].includes(text.toLowerCase())) return true;
  if (["否", "no", "false", "0"].includes(text.toLowerCase())) return false;
  throw new Error("开关请填写 是 或 否。");
}
function number(text: string): number {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error("请填写非负整数。");
  return Number(text);
}
const split = (text: string): string[] => text.split(/[,，]/).map(item => item.trim()).filter(Boolean);
const field = (key: string, label: string, initial: string, hint?: string): FormField =>
  hint ? { key, label, value: initial, hint } : { key, label, value: initial };

export class DaterApp {
  private world: World | null = null;
  private store: WorldStore | null = null;
  private calendar: Calendar | null = null;
  private lunar: LunarMapping | null = null;
  private selected: WorldDate = { year: "1", month: 1, day: 1 };
  private dialog: Dialog | null = null;
  private main: BoxRenderable | null = null;
  private agenda: SelectRenderable | null = null;
  private calendarBox: BoxRenderable | null = null;
  private search: InputRenderable | null = null;
  private searchDraft: string | null = null;
  private status = "欢迎使用 Dater。日期由你浏览与选择。";
  private dirty = false;
  private saving = false;
  private focus: "calendar" | "agenda" | "search" = "calendar";

  constructor(private readonly renderer: CliRenderer, private readonly exit: () => void) {
    renderer.keyInput.on("keypress", key => {
      try { this.onKey(key); } catch (error) { this.status = message(error); this.draw(); }
    });
    renderer.on("resize", () => { if (!this.dialog) this.draw(); });
  }

  async start(directory?: string): Promise<void> {
    this.draw();
    await this.run(() => this.openDirectory(directory ?? process.cwd(), true));
  }

  private activate(world: World, store: WorldStore, status: string): void {
    const calendar = new Calendar(world.calendar);
    const lunar = new LunarMapping(calendar, world.lunar);
    this.world = world;
    this.store = store;
    this.calendar = calendar;
    this.lunar = lunar;
    this.selected = { year: "1", month: 1, day: 1 };
    this.focus = "calendar";
    this.searchDraft = null;
    this.dirty = false;
    this.status = status;
    this.closeDialog();
    this.draw();
  }

  private closeDialog(): void {
    const dialog = this.dialog;
    this.dialog = null;
    dialog?.close();
  }
  private returnMain(): void {
    this.closeDialog();
    this.focus = "calendar";
    this.searchDraft = null;
    this.draw();
  }
  private showForm(title: string, fields: FormField[], submit: (values: Record<string, string>) => void | Promise<void>): void {
    this.closeDialog(); this.dialog = formDialog(this.renderer, title, fields, submit, () => this.returnMain());
  }
  private showMenu(title: string, items: { name: string; description?: string; action: () => void | Promise<void> }[]): void {
    this.closeDialog(); this.dialog = menuDialog(this.renderer, title, items, () => this.returnMain());
  }
  private confirm(title: string, body: string, action: () => void | Promise<void>): void {
    this.closeDialog(); this.dialog = confirmationDialog(this.renderer, title, body, action, () => this.returnMain());
  }
  private info(title: string, body: string): void {
    this.closeDialog(); this.dialog = informationDialog(this.renderer, title, body, () => this.returnMain());
  }
  private async run(action: () => void | Promise<void>): Promise<void> {
    try { await action(); } catch (error) { this.status = message(error); this.draw(); }
  }

  private async commit(world: World): Promise<void> {
    if (!this.store) throw new Error("尚未设置世界观目录。");
    world = validateWorld(world);
    this.world = world;
    this.calendar = new Calendar(world.calendar);
    this.lunar = new LunarMapping(this.calendar, world.lunar);
    this.dirty = true;
    this.saving = true;
    try {
      await this.store.save(world);
      this.dirty = false;
      this.status = "已保存。";
    } catch (error) {
      this.status = `保存失败，编辑内容仍在内存中：${message(error)}`;
      throw new Error(this.status);
    } finally { this.saving = false; }
  }

  private async ensureSaved(): Promise<void> { if (this.dirty && this.world) await this.commit(this.world); }

  private selectDate(event: MouseEvent, date: WorldDate | null): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== MouseButton.LEFT || !date || this.dialog || this.saving) return;
    this.selected = date;
    this.searchDraft = null;
    this.focus = "calendar";
    // Finish dispatch before destroying the renderable that received the click.
    queueMicrotask(() => { if (!this.dialog) this.draw(); });
  }

  private draw(): void {
    if (this.renderer.isDestroyed) return;
    this.main?.parent?.remove(this.main);
    this.main?.destroyRecursively();
    const root = new BoxRenderable(this.renderer, { id: "dater-main", width: "100%", height: "100%", flexDirection: "column",
      backgroundColor: colors.bg, paddingX: 1 });
    this.main = root; this.renderer.root.add(root);
    root.add(new TextRenderable(this.renderer, { content: clip(`Dater  /  ${this.world?.name ?? "选择世界观"}${this.dirty ? "  · 未保存" : ""}`, this.renderer.width - 2),
      fg: colors.accent, height: 1 }));
    root.add(new TextRenderable(this.renderer, { content: "g 检索  n 新日程  e 日程  h 节日  c 历法  l 农历  i 日期详情  w 世界观  ? 帮助  q 退出",
      fg: colors.muted, height: 2, wrapMode: "word" }));
    if (!this.world || !this.calendar || !this.lunar) {
      root.add(new TextRenderable(this.renderer, { content: "按 w 选择世界观目录，加载根部的 date.json；没有配置时再创建日历。", fg: colors.text, flexGrow: 1, wrapMode: "word" }));
      root.add(new TextRenderable(this.renderer, { content: this.status, fg: colors.muted, height: 3, wrapMode: "word" }));
      return;
    }
    const calendar = this.calendar;
    const lunar = this.lunar;
    try { calendar.validate(this.selected); } catch { this.selected = calendar.rollForward(this.selected); }
    const searchRow = new BoxRenderable(this.renderer, { height: 1, flexDirection: "row", flexShrink: 0 });
    searchRow.add(new TextRenderable(this.renderer, { content: "检索：", width: 6, fg: colors.muted }));
    const search = new InputRenderable(this.renderer, { value: this.searchDraft ?? this.selected.year, placeholder: "年份 或 年/月/日，Enter 跳转",
      flexGrow: 1, backgroundColor: colors.panel, textColor: colors.text, focusedBackgroundColor: colors.selected, maxLength: 280 });
    this.search = search; searchRow.add(search); root.add(searchRow);
    search.on("enter", () => {
      try {
        const date = search.value.includes("/") ? parseDate(search.value) : { year: parseYear(search.value), month: this.selected.month, day: 1 };
        calendar.validate(date); this.selected = date; this.searchDraft = null; this.focus = "calendar"; this.draw();
      } catch (error) { this.status = message(error); this.searchDraft = search.value; this.focus = "search"; this.draw(); }
    });
    const wide = this.renderer.width >= 100;
    const content = new BoxRenderable(this.renderer, { flexGrow: 1, minHeight: 1, flexDirection: wide ? "row" : "column", gap: 1 });
    root.add(content);
    const calendarBox = new BoxRenderable(this.renderer, { border: true, borderColor: this.focus === "calendar" ? colors.accent : colors.muted,
      title: clip(`${this.selected.year}年 · ${calendar.config.months[this.selected.month - 1]?.name ?? ""} · ${calendar.isLeap(BigInt(this.selected.year)) ? "闰年" : "平年"}`, Math.max(20, this.renderer.width - 45)),
      flexGrow: 1, minHeight: 4, flexDirection: "column", focusable: true, paddingX: 1 });
    this.calendarBox = calendarBox; content.add(calendarBox);
    const columns = calendar.config.weekdays.length;
    const availableWidth = this.renderer.width - (wide ? 42 : 8);
    const cellWidth = Math.floor(availableWidth / columns);
    const grid = cellWidth >= Math.max(2, String(calendar.monthDays(BigInt(this.selected.year), this.selected.month)).length) + 3;
    const lunarDisplay = lunar.describe(this.selected);
    const lunarNotes = [lunarDisplay?.solarTerm ? `节气：${lunarDisplay.solarTerm}` : "",
      lunarDisplay?.festivals.length ? `节日：${lunarDisplay.festivals.join("、")}` : ""].filter(Boolean);
    const lunarContent = [lunarDisplay?.dateLabel ?? lunar.label(this.selected), ...lunarNotes].join("\n");
    const lunarHeight = Math.min(4, lunarContent.split("\n").reduce((lines, text) =>
      lines + Math.max(1, Math.ceil(Bun.stringWidth(text) / Math.max(1, availableWidth))), 0));
    const agendaHeight = Math.max(4, Math.min(8, this.renderer.height - 15 - lunarHeight));
    const visibleRows = Math.max(1, Math.min(20,
      this.renderer.height - (wide ? 11 : 12 + agendaHeight) - lunarHeight - (grid ? 1 : 0)));
    const length = calendar.monthDays(BigInt(this.selected.year), this.selected.month);
    const offset = calendar.weekday({ ...this.selected, day: 1 });
    const selectedRow = Math.floor((this.selected.day - 1 + offset) / columns);
    const totalRows = Math.ceil((length + offset) / columns);
    const firstRow = Math.max(0, Math.min(totalRows - visibleRows, selectedRow - Math.floor(visibleRows / 2)));
    const firstDay = grid ? Math.max(1, firstRow * columns - offset + 1) : Math.max(1, this.selected.day - Math.floor(visibleRows / 2));
    const lastDay = grid ? Math.min(length, (firstRow + visibleRows) * columns - offset) : Math.min(length, firstDay + visibleRows - 1);
    const from = calendar.toDay({ ...this.selected, day: firstDay });
    const to = calendar.toDay({ ...this.selected, day: lastDay });
    const occurrences: EventOccurrence[] = [];
    try {
      for (const event of this.world.events) occurrences.push(...eventOccurrences(calendar, event, from, to));
      for (const holiday of this.world.holidays) occurrences.push(...holidayOccurrences(calendar, lunar, holiday, from, to));
    } catch (error) { this.status = message(error); }
    const selectedDay = calendar.toDay(this.selected);
    const includes = (item: EventOccurrence, day: bigint): boolean => calendar.toDay(item.start) <= day &&
      calendar.toDay(item.end) - (!item.allDay && item.endTime === "00:00" ? 1n : 0n) >= day;
    if (grid) {
      const weekdayRow = new BoxRenderable(this.renderer, { flexDirection: "row", height: 1, flexShrink: 0 });
      for (const name of calendar.config.weekdays) weekdayRow.add(new TextRenderable(this.renderer, { content: clip(` ${name}`, cellWidth - 1), width: cellWidth, fg: colors.muted }));
      calendarBox.add(weekdayRow);
      for (let row = firstRow; row < Math.min(totalRows, firstRow + visibleRows); row++) {
        const box = new BoxRenderable(this.renderer, { flexDirection: "row", height: 1, flexShrink: 0 });
        for (let column = 0; column < columns; column++) {
          const day = row * columns + column - offset + 1;
          const exists = day >= 1 && day <= length;
          const matching = exists ? occurrences.filter(item => includes(item, calendar.toDay({ ...this.selected, day }))) : [];
          const date = exists ? { ...this.selected, day } : null;
          box.add(new TextRenderable(this.renderer, { content: exists ? `${day === this.selected.day ? "›" : " "}${formatDateNumber(day)}${matching.length ? "•" : " "}` : "",
            width: cellWidth, fg: day === this.selected.day ? "#ffffff" : matching[0]?.color ?? colors.text,
            bg: day === this.selected.day ? colors.selected : colors.bg, selectable: false,
            onMouseDown: event => this.selectDate(event, date) }));
        }
        calendarBox.add(box);
      }
    } else {
      for (let day = firstDay; day <= lastDay; day++) {
        const date = { ...this.selected, day };
        const matching = occurrences.filter(item => includes(item, calendar.toDay(date)));
        calendarBox.add(new TextRenderable(this.renderer, { content: clip(`${day === this.selected.day ? "›" : " "}${formatDateNumber(day)}日 · ${calendar.config.weekdays[calendar.weekday(date)]} ${matching.length ? `• ${matching[0]?.title}` : ""}`, availableWidth),
          fg: matching[0]?.color ?? colors.text, bg: day === this.selected.day ? colors.selected : colors.bg, height: 1, flexShrink: 0,
          selectable: false, onMouseDown: event => this.selectDate(event, date) }));
      }
    }
    calendarBox.add(new TextRenderable(this.renderer, { content: lunarContent,
      fg: colors.muted, height: lunarHeight, flexShrink: 0, wrapMode: "word", width: "100%" }));
    calendarBox.add(new TextRenderable(this.renderer, { content: clip(`共 ${length} 天 · i 日期详情`, availableWidth),
      fg: colors.muted, height: 1, flexShrink: 0 }));
    const agendaBox = new BoxRenderable(this.renderer, { border: true, borderColor: this.focus === "agenda" ? colors.accent : colors.muted,
      title: `${formatDateNumber(this.selected.month)}/${formatDateNumber(this.selected.day)} 日程`, width: wide ? 34 : "100%", height: wide ? "100%" : agendaHeight,
      flexShrink: 0, flexDirection: "column", backgroundColor: colors.panel });
    content.add(agendaBox);
    const dayItems = occurrences.filter(item => includes(item, selectedDay)).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const agenda = new SelectRenderable(this.renderer, { flexGrow: 1, options: dayItems.length ? dayItems.map(item => ({
      name: `${item.source === "event" ? "" : "◆ "}${item.title}`,
      description: `${item.allDay ? "全天" : `${item.startTime}–${item.endTime}`} ${item.source === "lunar-holiday" ? "· 农历节日" : ""}`,
    })) : [{ name: "无日程", description: "按 n 创建，按 h 管理节日" }],
      backgroundColor: colors.panel, textColor: colors.text, focusedBackgroundColor: colors.panel,
      selectedBackgroundColor: colors.selected, selectedTextColor: "#ffffff", descriptionColor: colors.muted, showScrollIndicator: true });
    this.agenda = agenda; agendaBox.add(agenda);
    const synchronizeFocus = (focus: "calendar" | "agenda" | "search"): void => {
      if (this.dialog || this.main !== root) return;
      this.focus = focus;
      if (focus !== "search") this.searchDraft = null;
      calendarBox.borderColor = focus === "calendar" ? colors.accent : colors.muted;
      agendaBox.borderColor = focus === "agenda" ? colors.accent : colors.muted;
    };
    search.on("focused", () => synchronizeFocus("search"));
    calendarBox.on("focused", () => synchronizeFocus("calendar"));
    agenda.on("focused", () => synchronizeFocus("agenda"));
    agenda.on("itemSelected", (index: number) => {
      const item = dayItems[index];
      if (!item || this.dialog || this.saving) return;
      queueMicrotask(() => { void this.run(() => {
        if (!this.renderer.isDestroyed && !agenda.isDestroyed && !this.dialog && !this.saving &&
          this.focus === "agenda" && this.agenda === agenda) this.occurrenceMenu(item);
      }); });
    });
    root.add(new TextRenderable(this.renderer, { content: "←→ 日  ↑↓ 周  PgUp/PgDn 月  [ ] 年  Tab 焦点  Enter 日程  Esc 回日历  Ctrl+S 保存",
      fg: colors.muted, height: 2, wrapMode: "word" }));
    root.add(new TextRenderable(this.renderer, { content: clip(`${this.dirty ? "未保存 · " : ""}${this.status}\n目录：${this.store?.directory ?? ""}`, this.renderer.width * 2 - 4),
      fg: this.dirty ? "#ffa2a2" : colors.muted, height: 2, wrapMode: "word" }));
    if (!this.dialog) {
      if (this.focus === "search") search.focus(); else if (this.focus === "agenda") agenda.focus(); else calendarBox.focus();
    }
  }

  private onKey(key: KeyEvent): void {
    if (key.eventType === "release") return;
    if (key.ctrl && key.name === "c") { key.preventDefault(); if (!this.saving) this.requestExit(); return; }
    if (this.dialog) { this.dialog.handle(key); return; }
    if (this.saving) { key.preventDefault(); return; }
    if (this.focus === "search" && this.world) {
      if (key.name === "escape" || key.name === "tab") { key.preventDefault(); this.searchDraft = null; this.focus = "calendar"; this.draw(); }
      else if (key.ctrl && key.name === "u") { key.preventDefault(); if (this.search) this.search.value = ""; }
      return;
    }
    if (key.ctrl && key.name === "s") { key.preventDefault(); void this.run(async () => { await this.ensureSaved(); this.status = "已保存。"; this.draw(); }); return; }
    const actions: Record<string, () => void | Promise<void>> = {
      q: () => this.requestExit(), g: () => { this.focus = "search"; this.search?.focus(); },
      n: () => this.editEvent(), e: () => this.eventMenu(), h: () => this.holidayMenu(),
      c: () => this.calendarMenu(), l: () => this.editLunar(), i: () => this.dateInfo(), w: () => this.worldMenu(),
      "?": () => this.help(),
    };
    const action = actions[key.sequence] ?? actions[key.name];
    if (action && !key.ctrl && !key.meta) { key.preventDefault(); void this.run(action); return; }
    if (!this.calendar || !this.world) return;
    if (key.name === "tab") {
      key.preventDefault(); this.focus = this.focus === "calendar" ? "agenda" : "calendar"; this.draw(); return;
    }
    if (key.name === "escape") {
      key.preventDefault(); this.focus = "calendar"; this.searchDraft = null; this.draw(); return;
    }
    if (["return", "enter"].includes(key.name) && this.focus === "calendar") {
      key.preventDefault(); this.focus = "agenda"; this.agenda?.focus(); return;
    }
    if (this.focus === "agenda") return;
    const calendar = this.calendar;
    const step: Record<string, number> = { left: -1, right: 1, up: -calendar.config.weekdays.length, down: calendar.config.weekdays.length };
    if (key.name in step) {
      key.preventDefault(); void this.run(() => { this.selected = calendar.fromDay(calendar.toDay(this.selected) + BigInt(step[key.name] ?? 0)); this.draw(); });
    } else if (["pageup", "pagedown"].includes(key.name)) {
      key.preventDefault();
      const count = calendar.config.months.length;
      let month = this.selected.month + (key.name === "pageup" ? -1 : 1);
      let year = BigInt(this.selected.year);
      if (month < 1) { month = count; year--; } else if (month > count) { month = 1; year++; }
      this.selected = { year: parseYear(year.toString()), month, day: Math.min(this.selected.day, calendar.monthDays(year, month)) };
      this.draw();
    } else if (["[", "]"].includes(key.sequence)) {
      key.preventDefault();
      const year = BigInt(this.selected.year) + (key.sequence === "[" ? -1n : 1n);
      this.selected = { ...this.selected, year: parseYear(year.toString()), day: Math.min(this.selected.day, calendar.monthDays(year, this.selected.month)) };
      this.draw();
    }
  }

  requestExit(): void {
    if (!this.dirty) { this.closeDialog(); this.exit(); return; }
    this.showMenu("有尚未保存的编辑", [
      { name: "重试保存并退出", action: async () => { await this.ensureSaved(); this.exit(); } },
      { name: "继续编辑", action: () => this.returnMain() },
      { name: "放弃未保存内容并退出", action: () => this.confirm("放弃编辑", "磁盘文件保持原内容，内存中的修改将丢失。", () => this.exit()) },
    ]);
  }

  private chooseDirectory(directory = this.store?.directory ?? process.cwd()): void {
    this.showForm("选择世界观目录", [field("directory", "世界观目录", directory,
      "先加载根部的 date.json；没有配置时再创建。一个目录保存一个世界观。")],
    values => this.openDirectory(value(values, "directory")));
  }

  private async openDirectory(directory: string, promptForDirectory = false): Promise<void> {
    await this.ensureSaved();
    const store = new WorldStore(directory);
    const world = await store.load();
    if (world) {
      this.activate(world, store, "世界观已加载。");
      return;
    }
    const legacy = await store.listLegacy();
    const migrate = async (id: string): Promise<void> => {
      await this.ensureSaved();
      const migrated = await store.migrateLegacy(id);
      this.activate(migrated, store, "已迁移到 date.json，旧文件仍保留。");
      if (legacy.errors.length) this.info("旧文件读取提示", legacy.errors.join("\n\n"));
    };
    if (legacy.worlds.length === 1 && legacy.worlds[0]) {
      await migrate(legacy.worlds[0].id);
    } else if (legacy.worlds.length > 1) {
      this.showMenu("选择迁移的世界观 · 旧文件仍保留", [
        ...legacy.worlds.map(item => ({ name: item.name, description: `dater_date/${item.id}.json`, action: () => migrate(item.id) })),
        ...(legacy.errors.length ? [{ name: `查看 ${legacy.errors.length} 个旧文件读取错误`,
          action: () => this.info("旧文件读取错误", legacy.errors.join("\n\n")) }] : []),
      ]);
    } else if (legacy.errors.length) {
      throw new Error(`旧文件无法读取，未创建新配置：\n${legacy.errors.join("\n")}`);
    } else if (promptForDirectory) {
      this.chooseDirectory(store.directory);
    } else {
      this.createWorld(store);
    }
  }

  private createWorld(store: WorldStore): void {
    this.showForm("创建世界观", [field("name", "世界观名称", "我的世界", `配置将保存为 ${store.filePath}`)], async values => {
      await this.ensureSaved();
      const world = await store.create(value(values, "name"));
      this.activate(world, store, "世界观已创建，使用可编辑的公历默认值。");
    });
  }

  private worldMenu(): void {
    this.showMenu("世界观 · 一个目录一份配置", [
      { name: "打开其他世界观目录", action: () => this.chooseDirectory() },
      { name: "＋ 在其他目录创建世界观", description: "若目标目录已有配置，将加载原配置。", action: () => this.chooseDirectory() },
      ...(this.world ? [{ name: "重命名当前世界观", action: () => this.showForm("重命名", [field("name", "名称", this.world?.name ?? "")], async values => {
        if (this.world) { await this.commit({ ...this.world, name: value(values, "name") }); this.returnMain(); }
      }) }] : []),
    ]);
  }

  private calendarMenu(): void {
    if (!this.world) return;
    this.showMenu("历法设置", [
      { name: "编辑月份、星期和闰年", description: "独立月份天数、周期、单年覆盖、正则闰年", action: () => this.editCalendar() },
      { name: "恢复完整公历预设", description: "12 个月、7 天星期、世纪例外规则；应用前预览风险", action: () => {
        if (this.world) this.applyCalendar(defaultCalendar(), this.world.lunar);
      } },
    ]);
  }

  private editCalendar(): void {
    const world = this.world;
    if (!world) return;
    const config = world.calendar;
    this.showForm("编辑历法", [
      field("months", "月份（名称:平年天数，用逗号分隔）", config.months.map(item => `${item.name}:${item.days}`).join(","), "每个月独立设置，月份数量由条目数决定。"),
      field("weekdays", "星期名称（逗号分隔）", config.weekdays.join(",")),
      field("weekdayOffset", "第 0 年 1 月 1 日对应第几个星期名称", String(config.weekdayOffset + 1), "按列表顺序从 1 开始计数；公历预设为星期六。"),
      field("kind", "基础闰年规则", config.leap.kind, "gregorian 完整公历 / interval 固定间隔 / none 无基础闰年"),
      field("interval", "固定闰年间隔", config.leap.interval),
      field("anchor", "周期基准年", config.leap.anchorYear, "向前后延伸；支持负年与 0。"),
      field("additions", "闰日分配（月序号:增加天数，逗号分隔）", config.leap.additions.map(item => `${item.month}:${item.days}`).join(","), "例如 2:1,8:2；同一月份仅设置一次。"),
      field("overrides", "单年覆盖（年:闰 或 年:平，逗号分隔）", Object.entries(config.leap.overrides).map(([year, leap]) => `${year}:${leap ? "闰" : "平"}`).join(","), "单年覆盖优先于正则与基础规则。"),
      field("patterns", "正则强制闰年（多条以 ;; 分隔）", config.leap.patterns.join(";;"), "例如 7$ 或 ^-?[0-9]*8$；支持范围详见 ? 帮助。"),
    ], values => {
      const months = split(value(values, "months")).map(text => {
        const match = /^(.*):(\d+)$/.exec(text);
        if (!match?.[1] || !match[2]) throw new Error("月份格式须为 名称:天数。");
        return { name: match[1].trim(), days: number(match[2]) };
      });
      const pairs = (text: string): string[][] => split(text).map(item => item.split(":"));
      const overrides: Record<string, boolean> = {};
      for (const [year, rule] of pairs(value(values, "overrides"))) {
        if (!year || !rule || !["闰", "平"].includes(rule)) throw new Error("单年覆盖格式为 年:闰 或 年:平。");
        const canonical = parseYear(year);
        if (Object.hasOwn(overrides, canonical)) throw new Error("同一年不能重复设置覆盖。");
        overrides[canonical] = rule === "闰";
      }
      const result = validateCalendar({ months, weekdays: split(value(values, "weekdays")), weekdayOffset: number(value(values, "weekdayOffset")) - 1, leap: {
        kind: value(values, "kind"), interval: parseYear(value(values, "interval")), anchorYear: parseYear(value(values, "anchor")),
        additions: pairs(value(values, "additions")).map(([month, days]) => ({ month: number(month ?? ""), days: number(days ?? "") })),
        patterns: value(values, "patterns").split(";;").map(text => text.trim()).filter(Boolean), overrides,
      } });
      this.applyCalendar(result, world.lunar);
    });
  }

  private applyCalendar(config: CalendarConfig, lunar: LunarConfig): void {
    const world = this.world;
    if (!world) return;
    const preview = previewMigration(world, config, lunar, this.selected);
    this.confirm("历法 / 农历变更风险确认", [
      "普通日程保留年月日，无效日期将顺延；农历节日按新规则重新映射。取消会保留原数据。",
      "重复规则仍保留各条日程的跳过 / 顺延选项。",
      "以下是日期调整与农历对照变化（重复日程预览当前所选日期起 60 天）：", ...(preview.changes.length ? preview.changes : ["现有日程没有需要顺延的日期。"]),
    ].join("\n\n"), async () => {
      await this.commit(preview.world);
      this.selected = new Calendar(config).rollForward(this.selected);
      this.returnMain();
    });
  }

  private editLunar(): void {
    const world = this.world;
    if (!world || !this.calendar) return;
    const anchor = world.lunar.anchor;
    this.showForm("农历基准与循环", [
      field("enabled", "启用农历对照（是 / 否）", "是"),
      field("world", "世界观基准日期", formatDate(anchor?.world ?? this.selected), "年/月/日；此日期与下方现实农历日期为同一天。"),
      field("year", "现实农历年份", String(anchor?.lunar.year ?? 2024), "明确的公元年号，支持完整 1900–2100 农历年。"),
      field("month", "现实农历月份", formatDateNumber(anchor?.lunar.month ?? 8)),
      field("day", "现实农历日期", formatDateNumber(anchor?.lunar.day ?? 15)),
      field("leap", "基准为闰月（是 / 否）", anchor?.lunar.leap ? "是" : "否"),
      field("cyclic", "超出范围循环农历（是 / 否）", world.lunar.cyclic ? "是" : "否", "循环结果明确标识；过去和未来越界均循环。"),
    ], values => {
      if (!this.calendar) return;
      const lunar = validateLunar({ cyclic: yes(value(values, "cyclic")), anchor: yes(value(values, "enabled")) ? {
        world: parseDate(value(values, "world")), lunar: { year: number(value(values, "year")), month: number(value(values, "month")),
          day: number(value(values, "day")), leap: yes(value(values, "leap")) },
      } : null }, this.calendar);
      this.applyCalendar(world.calendar, lunar);
    });
  }

  private detailsFields(details?: EventDetails): FormField[] {
    return [field("title", "标题", details?.title ?? ""), field("note", "备注", details?.note.replaceAll("\n", "\\n") ?? "", "输入 \\n 表示换行。"),
      field("color", "颜色 (#RRGGBB)", details?.color ?? "#7edbc1"),
      field("start", "开始日期", formatDate(details?.start ?? this.selected)),
      field("end", "结束日期（全天包含此日）", formatDate(details?.end ?? this.selected)),
      field("allDay", "全天（是 / 否）", details?.allDay === false ? "否" : "是"),
      field("startTime", "开始时间", details?.startTime ?? "09:00", "定时日程使用 24 小时制 HH:mm。"),
      field("endTime", "结束时间", details?.endTime ?? "10:00")];
  }

  private readDetails(values: Record<string, string>): EventDetails {
    if (!this.calendar) throw new Error("尚未打开世界观。");
    return validateDetails({ title: value(values, "title"), note: value(values, "note").replaceAll("\\n", "\n"), color: value(values, "color"),
      start: parseDate(value(values, "start")), end: parseDate(value(values, "end")), allDay: yes(value(values, "allDay")),
      startTime: value(values, "startTime"), endTime: value(values, "endTime") }, this.calendar);
  }

  private editEvent(event?: CalendarEvent): void {
    if (!this.world || !this.calendar) return;
    this.showForm(event ? "编辑整个日程" : "创建日程", [ ...this.detailsFields(event),
      field("frequency", "重复频率", event?.recurrence.frequency ?? "none", "none 不重复 / daily 每日 / weekly 每周 / monthly 每月 / yearly 每年"),
      field("interval", "重复间隔", String(event?.recurrence.interval ?? 1)),
      field("invalid", "不存在日期处理", event?.recurrence.invalidDate ?? "skip", "skip 跳过 / roll-forward 顺延"),
      field("until", "重复截止日期（空白为无限）", event?.recurrence.until ? formatDate(event.recurrence.until) : ""),
    ], async values => {
      if (!this.world || !this.calendar) return;
      const details = this.readDetails(values);
      const frequency = value(values, "frequency");
      const interval = number(value(values, "interval"));
      const changed = event && (formatDate(event.start) !== formatDate(details.start) || frequency !== event.recurrence.frequency || interval !== event.recurrence.interval);
      const next = validateEvent({ ...details, id: event?.id ?? randomUUID(), recurrence: {
        frequency, interval, invalidDate: value(values, "invalid"), until: value(values, "until") ? parseDate(value(values, "until")) : null,
      }, exceptions: changed ? [] : event?.exceptions ?? [] }, this.calendar);
      const save = async (): Promise<void> => {
        if (!this.world) return;
        await this.commit({ ...this.world, events: [...this.world.events.filter(item => item.id !== next.id), next] }); this.returnMain();
      };
      if (changed && event.exceptions.length) this.confirm("重复规则变更", `开始日期或重复节奏发生变化，${event.exceptions.length} 条单次修改或取消将清除。`, save);
      else await save();
    });
  }

  private eventMenu(): void {
    if (!this.world) return;
    this.showMenu("全部日程", [{ name: "＋ 创建日程", action: () => this.editEvent() },
      ...this.world.events.map(event => ({ name: event.title, description: `${formatDate(event.start)} · ${event.recurrence.frequency}`,
        action: () => this.seriesMenu(event) }))]);
  }

  private seriesMenu(event: CalendarEvent): void {
    this.showMenu(event.title, [
      { name: "查看详情", action: () => this.details(event) },
      { name: "编辑整个日程", action: () => this.editEvent(event) },
      ...(event.exceptions.length ? [{ name: "管理单次例外", description: `${event.exceptions.length} 条修改或取消`, action: () => this.showMenu("单次例外 · Enter 恢复原重复", event.exceptions.map(exception => ({
        name: `第 ${BigInt(exception.key) + 1n} 次 · ${exception.replacement ? exception.replacement.title : "已取消"}`,
        description: exception.replacement ? formatDate(exception.replacement.start) : "Enter 恢复此次数",
        action: async () => {
          if (!this.world) return;
          const next = { ...event, exceptions: event.exceptions.filter(item => item.key !== exception.key) };
          await this.commit({ ...this.world, events: this.world.events.map(item => item.id === next.id ? next : item) }); this.returnMain();
        },
      }))) }] : []),
      { name: "删除整个日程", action: () => this.confirm("删除日程", `确认删除「${event.title}」及其全部重复与单次例外？`, async () => {
        if (this.world) { await this.commit({ ...this.world, events: this.world.events.filter(item => item.id !== event.id) }); this.returnMain(); }
      }) },
    ]);
  }

  private occurrenceMenu(item: EventOccurrence): void {
    if (!this.world) return;
    if (item.source !== "event") {
      const holiday = this.world.holidays.find(holiday => holiday.id === item.id);
      if (holiday) this.holidayActions(holiday);
      return;
    }
    const event = this.world.events.find(event => event.id === item.id);
    if (!event) return;
    if (event.recurrence.frequency === "none") { this.seriesMenu(event); return; }
    this.showMenu(`${item.title} · 第 ${BigInt(item.key) + 1n} 次`, [
      { name: "查看这一次详情", action: () => this.details(item) },
      { name: "修改这一次", action: () => this.showForm("修改这一次", this.detailsFields(item), async values => {
        const replacement = this.readDetails(values); await this.saveException(event, item.key, replacement); this.returnMain();
      }) },
      { name: "取消这一次", action: () => this.confirm("取消这一次", `${formatDate(item.start)} 的这一次将取消，其他重复保留。`, async () => {
        await this.saveException(event, item.key, null); this.returnMain();
      }) },
      { name: "管理整个日程", action: () => this.seriesMenu(event) },
    ]);
  }

  private async saveException(event: CalendarEvent, key: string, replacement: EventDetails | null): Promise<void> {
    if (!this.world) return;
    const next = { ...event, exceptions: [...event.exceptions.filter(item => item.key !== key), { key, replacement }] };
    await this.commit({ ...this.world, events: this.world.events.map(item => item.id === next.id ? next : item) });
  }

  private holidayMenu(): void {
    if (!this.world) return;
    this.showMenu("节日", [{ name: "＋ 创建节日", action: () => this.editHoliday() },
      ...this.world.holidays.map(holiday => ({ name: holiday.title, description: `${holiday.kind === "lunar" ? "农历" : "世界观"} ${formatDateNumber(holiday.month)}/${formatDateNumber(holiday.day)}`,
        action: () => this.holidayActions(holiday) }))]);
  }

  private holidayActions(holiday: Holiday): void {
    this.showMenu(holiday.title, [{ name: "查看详情", action: () => this.info(holiday.title, `${holiday.kind === "lunar" ? "农历" : "世界观固定"} ${formatDateNumber(holiday.month)}月${formatDateNumber(holiday.day)}日\n\n${holiday.note || "无备注"}`) },
      { name: "编辑节日", action: () => this.editHoliday(holiday) },
      { name: "删除节日", action: () => this.confirm("删除节日", `确认删除「${holiday.title}」？`, async () => {
        if (this.world) { await this.commit({ ...this.world, holidays: this.world.holidays.filter(item => item.id !== holiday.id) }); this.returnMain(); }
      }) }]);
  }

  private editHoliday(holiday?: Holiday): void {
    if (!this.world) return;
    this.showForm(holiday ? "编辑节日" : "创建节日", [
      field("title", "标题", holiday?.title ?? ""), field("note", "备注", holiday?.note.replaceAll("\n", "\\n") ?? ""),
      field("color", "颜色 (#RRGGBB)", holiday?.color ?? "#ffd580"),
      field("kind", "节日类型", holiday?.kind ?? "fixed", "fixed 世界观固定月日 / lunar 农历节日"),
      field("month", "月份", formatDateNumber(holiday?.month ?? this.selected.month)), field("day", "日期", formatDateNumber(holiday?.day ?? this.selected.day)),
      field("repeatLeap", "农历闰月也重复（是 / 否）", holiday?.repeatLeap ? "是" : "否"),
      field("invalid", "不存在日期处理", holiday?.invalidDate ?? "skip", "skip 跳过 / roll-forward 顺延；农历必须先设置基准。"),
    ], async values => {
      if (!this.world || !this.calendar) return;
      const next = validateHoliday({ id: holiday?.id ?? randomUUID(), title: value(values, "title"), note: value(values, "note").replaceAll("\\n", "\n"),
        color: value(values, "color"), kind: value(values, "kind"), month: number(value(values, "month")), day: number(value(values, "day")),
        repeatLeap: yes(value(values, "repeatLeap")), invalidDate: value(values, "invalid") }, this.calendar);
      await this.commit({ ...this.world, holidays: [...this.world.holidays.filter(item => item.id !== next.id), next] }); this.returnMain();
    });
  }

  private help(): void {
    this.info("Dater 使用帮助", [
      "g：按年份或 年/月/日 检索；支持负年、0 年及最多 256 位年份。输入框中 Ctrl+U 清空、Enter 提交、Esc 返回。",
      "←→ 移动一天，↑↓ 移动一个世界观星期，PgUp/PgDn 换月，[ / ] 换年。鼠标左键可点选日期。Tab 切换日历与当日列表，Enter 管理日程；列表内 ↑↓ 选择日程，Esc 返回日历。关闭对话框后回到日历焦点。",
      "n 新日程；e 全部日程；h 固定或农历节日；c 自定义历法；l 农历基准与循环；i 日期详情（完整农历、节气及传统民俗节日）；w 世界观与目录。表单 Tab 切换，Ctrl+S 保存，Esc 取消。",
      "基础规则、公历世纪例外、正则强制闰年、单年覆盖的优先级：单年覆盖 > 正则 > 基础规则。多个正则命中不叠加闰日。",
      "正则匹配规范十进制年份，负年保留负号。支持数字、负号、\\d、.、字符组及数字范围、分组、|、?、*、+、{n,m}、首尾 ^ 和 $；不支持环视、回溯引用和标志。最多 8 条，每条 160 字符，有限重复最多 32，自动机最多 96 状态；组合正则时固定周期最多 400。",
      "农历仅在 1900–2100 完整农历年内对应现实。循环开关重复整段月份数据，越界后的农历年明确标为循环年份；关闭时显示农历不可用。",
      "修改历法会显示风险预览，Ctrl+Y 明确确认后应用。保存失败保留内存编辑，Ctrl+S 可重试。每个世界观目录保存一份 date.json；启动先检查显式目录或终端当前目录。",
      "Dater 没有世界观“今天”，不与现实时间绑定。定时日程使用 24 小时制；所有日期属于当前世界观。",
    ].join("\n\n"));
  }

  private dateInfo(): void {
    if (!this.calendar || !this.lunar) return;
    const display = this.lunar.describe(this.selected);
    this.info("日期详情", [formatDate(this.selected),
      `${this.calendar.config.months[this.selected.month - 1]?.name ?? ""} · ${this.calendar.config.weekdays[this.calendar.weekday(this.selected)] ?? ""}`,
      this.lunar.label(this.selected),
      ...(display ? [`节气：${display.solarTerm ?? "无"}`, `传统民俗节日：${display.festivals.join("、") || "无"}`] : []),
    ].join("\n\n"));
  }

  private details(details: EventDetails): void {
    this.info(details.title, `${formatDate(details.start)}–${formatDate(details.end)}\n${details.allDay ? "全天" : `${details.startTime}–${details.endTime}`}\n\n${details.note || "无备注"}`);
  }
}
