#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { DaterApp } from "./tui/app.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("Dater — 原创世界观日历管理\n\n用法：dater [世界观目录]\n开发运行：pnpm start [世界观目录]\n数据保存为世界观目录根部的 date.json。无参数时先检查当前终端目录；没有文件时在界面中选择目录。\n");
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("Dater 需要交互式终端，请在终端中运行 dater 或 pnpm start。\n");
  process.exitCode = 1;
} else {
  let renderer: CliRenderer | undefined;
  let closing = false;
  const finish = (code = 0): void => {
    if (closing) return;
    closing = true;
    renderer?.destroy();
    process.stdin.pause();
    process.exitCode = code;
  };
  const failure = (error: unknown): void => {
    finish(1);
    process.stderr.write(`Dater：${error instanceof Error ? error.message : String(error)}\n`);
  };
  try {
    renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], useMouse: true, backgroundColor: "#101923",
      screenMode: "alternate-screen", consoleMode: "disabled", openConsoleOnError: false, targetFps: 30 });
    const app = new DaterApp(renderer, () => finish());
    process.on("SIGINT", () => app.requestExit());
    process.on("SIGTERM", () => finish(143));
    process.on("uncaughtException", failure);
    process.on("unhandledRejection", failure);
    renderer.on("render:error", ({ error }: { error: unknown }) => failure(error));
    await app.start(args[0] ?? process.cwd());
  } catch (error) { failure(error); }
}
