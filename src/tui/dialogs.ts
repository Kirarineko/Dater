import { BoxRenderable, InputRenderable, ScrollBoxRenderable, SelectRenderable, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";

export interface FormField { key: string; label: string; value: string; hint?: string }
export type Dialog = { handle(key: KeyEvent): void; close(): void };
const colors = { bg: "#172335", text: "#e4edf7", muted: "#a5b4c8", accent: "#7edbc1", error: "#ffa2a2" };

function frame(renderer: CliRenderer, title: string): BoxRenderable {
  const overlay = new BoxRenderable(renderer, { id: "dialog-overlay", position: "absolute", top: 0, left: 0,
    width: "100%", height: "100%", backgroundColor: "#0c1420", justifyContent: "center", alignItems: "center", zIndex: 100 });
  const box = new BoxRenderable(renderer, { id: "dialog-panel", border: true, borderColor: colors.accent, title,
    backgroundColor: colors.bg, width: "94%", maxWidth: 105, height: "94%", paddingX: 1, flexDirection: "column" });
  overlay.add(box); renderer.root.add(overlay);
  return box;
}

function destroy(box: BoxRenderable): void {
  const overlay = box.parent;
  if (overlay) { overlay.parent?.remove(overlay); overlay.destroyRecursively(); }
}

export function formDialog(renderer: CliRenderer, title: string, fields: FormField[],
  submit: (values: Record<string, string>) => void | Promise<void>, cancel: () => void): Dialog {
  const box = frame(renderer, title);
  box.add(new TextRenderable(renderer, { content: "Tab / Shift+Tab 切换 · Ctrl+U 清空当前字段 · Ctrl+S 保存 · Esc 取消", fg: colors.muted, height: 1 }));
  const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollY: true, contentOptions: { flexDirection: "column" } });
  box.add(scroll);
  const inputs: InputRenderable[] = [];
  let index = 0;
  for (const field of fields) {
    const row = new BoxRenderable(renderer, { id: `field-${field.key}`, flexDirection: "column", height: field.hint ? 4 : 3, flexShrink: 0 });
    row.add(new TextRenderable(renderer, { content: field.label, fg: colors.text, height: 1 }));
    const input = new InputRenderable(renderer, { value: field.value, backgroundColor: "#23334b", textColor: colors.text,
      focusedBackgroundColor: "#314865", focusedTextColor: "#ffffff", width: "100%", maxLength: 12000 });
    const position = inputs.length;
    input.on("focused", () => { index = position; });
    inputs.push(input); row.add(input);
    if (field.hint) row.add(new TextRenderable(renderer, { content: field.hint, fg: colors.muted, height: 1 }));
    scroll.add(row);
  }
  const message = new TextRenderable(renderer, { content: "", fg: colors.error, height: 2, wrapMode: "word", flexShrink: 0 });
  box.add(message);
  let busy = false;
  const focus = (): void => {
    inputs[index]?.focus();
    const field = fields[index];
    if (field) scroll.scrollChildIntoView(`field-${field.key}`);
  };
  const save = (): void => {
    if (busy) return;
    busy = true;
    const values = Object.fromEntries(fields.map((field, position) => [field.key, inputs[position]?.value ?? ""]));
    Promise.resolve().then(() => {
      if (!renderer.isDestroyed && !box.isDestroyed) return submit(values);
    }).catch((error: unknown) => {
      if (!renderer.isDestroyed && !message.isDestroyed) message.content = error instanceof Error ? error.message : String(error);
    }).finally(() => { busy = false; });
  };
  for (const input of inputs) input.on("enter", () => {
    if (index + 1 === inputs.length) save();
    else { index++; focus(); }
  });
  focus();
  return { close: () => destroy(box), handle: (key: KeyEvent) => {
    if (key.name === "escape" && !busy) { key.preventDefault(); cancel(); }
    else if (key.name === "tab") { key.preventDefault(); index = (index + (key.shift ? inputs.length - 1 : 1)) % inputs.length; focus(); }
    else if (key.ctrl && key.name === "u") { key.preventDefault(); const input = inputs[index]; if (input) input.value = ""; }
    else if (key.ctrl && key.name === "s") { key.preventDefault(); save(); }
  } };
}

export function menuDialog(renderer: CliRenderer, title: string, items: { name: string; description?: string; action: () => void | Promise<void> }[],
  cancel: () => void): Dialog {
  const box = frame(renderer, title);
  box.add(new TextRenderable(renderer, { content: "↑↓ 选择 · Enter 打开 · Esc 返回", fg: colors.muted, height: 1 }));
  const select = new SelectRenderable(renderer, { flexGrow: 1, backgroundColor: colors.bg, textColor: colors.text,
    focusedBackgroundColor: colors.bg, selectedBackgroundColor: "#314865", selectedTextColor: "#ffffff", descriptionColor: colors.muted,
    options: items.map(item => ({ name: item.name, description: item.description ?? "" })), showDescription: true, showScrollIndicator: true });
  box.add(select);
  const message = new TextRenderable(renderer, { content: "", fg: colors.error, height: 2, wrapMode: "word" });
  box.add(message);
  let busy = false;
  select.on("itemSelected", (index: number) => {
    if (busy) return;
    busy = true;
    Promise.resolve().then(() => {
      if (!renderer.isDestroyed && !box.isDestroyed) return items[index]?.action();
    }).catch((error: unknown) => {
      if (!renderer.isDestroyed && !message.isDestroyed) message.content = error instanceof Error ? error.message : String(error);
    }).finally(() => { busy = false; });
  });
  select.focus();
  return { close: () => destroy(box), handle: (key: KeyEvent) => {
    if (key.name === "escape" && !busy) { key.preventDefault(); cancel(); }
  } };
}

export function confirmationDialog(renderer: CliRenderer, title: string, body: string, confirm: () => void | Promise<void>, cancel: () => void): Dialog {
  const box = frame(renderer, title);
  box.add(new TextRenderable(renderer, { content: "请查看影响后明确确认。↑↓ / PgUp/PgDn 滚动 · Ctrl+Y 确认 · Esc 取消", fg: colors.muted, height: 2, wrapMode: "word" }));
  const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollY: true });
  scroll.add(new TextRenderable(renderer, { content: body, fg: colors.text, wrapMode: "word", width: "100%" }));
  box.add(scroll);
  const message = new TextRenderable(renderer, { content: "", fg: colors.error, height: 2, wrapMode: "word" });
  box.add(message);
  let busy = false;
  scroll.focus();
  return { close: () => destroy(box), handle: (key: KeyEvent) => {
    if (key.name === "escape" && !busy) { key.preventDefault(); cancel(); }
    else if (key.ctrl && key.name === "y" && !busy) {
      key.preventDefault(); busy = true;
      Promise.resolve().then(() => {
        if (!renderer.isDestroyed && !box.isDestroyed) return confirm();
      }).catch((error: unknown) => {
        if (!renderer.isDestroyed && !message.isDestroyed) message.content = error instanceof Error ? error.message : String(error);
      }).finally(() => { busy = false; });
    }
  } };
}

export function informationDialog(renderer: CliRenderer, title: string, body: string, close: () => void): Dialog {
  const box = frame(renderer, title);
  box.add(new TextRenderable(renderer, { content: "↑↓ / PgUp/PgDn 滚动 · Enter / Esc 返回", fg: colors.muted, height: 1 }));
  const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollY: true });
  scroll.add(new TextRenderable(renderer, { content: body, fg: colors.text, wrapMode: "word", width: "100%" }));
  box.add(scroll); scroll.focus();
  return { close: () => destroy(box), handle: (key: KeyEvent) => {
    if (["escape", "return", "enter"].includes(key.name)) { key.preventDefault(); close(); }
  } };
}

export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (Bun.stringWidth(text) <= width) return text;
  let result = "";
  for (const { segment } of new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)) {
    if (Bun.stringWidth(result + segment + "…") > width) break;
    result += segment;
  }
  return result + "…";
}
