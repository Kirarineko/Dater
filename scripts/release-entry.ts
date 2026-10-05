import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

// Resolve from the installed executable, including /usr/bin symlinks and AppImage
// mounts. Keep the caller's working directory for world selection and storage.
const assets = join(dirname(realpathSync(process.execPath)), "assets");
const nativeFile = process.platform === "win32" ? "opentui.dll" : "libopentui.so";
const nativePackage = `@opentui/core-${process.platform}-${process.arch}`;
if (!existsSync(join(assets, nativePackage, nativeFile))) {
  process.stderr.write("Dater：原生运行资源缺失，请保留可执行文件旁的完整 assets 目录或重新安装。\n");
  process.exitCode = 1;
} else {
  process.env.OTUI_ASSET_ROOT = assets;
  if (process.platform === "linux") process.env.OPENTUI_LIBC = "glibc";
  // OpenTUI resolves native assets during module initialization, so initialize the
  // asset root before importing any application or OpenTUI module.
  await import("../src/index.ts");
}
