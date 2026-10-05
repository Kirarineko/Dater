import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNodeAssets } from "@opentui/core/node-assets";
import type { BunPlugin } from "bun";

interface PackageMetadata {
  name: string;
  version: string;
  license: string;
  dependencies: Record<string, string>;
}

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform;
if ((platform !== "linux" && platform !== "win32") || process.arch !== "x64") {
  throw new Error("发布构建仅支持本机 Linux x64 或 Windows x64 runner；请在目标系统安装依赖后构建。");
}
const platformName = platform === "win32" ? "windows" : "linux";
const nativePackage = `@opentui/core-${platform}-x64`;
const payload = join(project, "release", `${platformName}-x64`);
const executable = join(payload, platform === "win32" ? "dater.exe" : "dater");
const assets = getNodeAssets({ platform, arch: "x64" });
const bunLicensePath = process.env.DATER_BUN_LICENSE;
if (!bunLicensePath || !(await stat(bunLicensePath)).isFile()) {
  throw new Error("请设置 DATER_BUN_LICENSE，指向当前 Bun 版本的官方 LICENSE 文件；工作流负责准备该文件。");
}

async function packageMetadata(directory: string): Promise<PackageMetadata> {
  const parsed: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string" ||
      !("version" in parsed) || typeof parsed.version !== "string") {
    throw new Error(`包元数据无效：${directory}`);
  }
  const dependencies: Record<string, string> = {};
  if ("dependencies" in parsed && typeof parsed.dependencies === "object" && parsed.dependencies !== null) {
    for (const [name, version] of Object.entries(parsed.dependencies)) {
      if (typeof version !== "string") throw new Error(`依赖版本无效：${name}`);
      dependencies[name] = version;
    }
  }
  return { name: parsed.name, version: parsed.version,
    license: "license" in parsed && typeof parsed.license === "string" ? parsed.license : "见随包许可证", dependencies };
}

async function packageRoot(name: string, from: string): Promise<string> {
  let directory = dirname(Bun.resolveSync(name, from));
  while (true) {
    try {
      // Some packages contain a nested package.json that only sets module type
      // (for example diff/libesm). Keep walking to the named package root.
      const candidate: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (typeof candidate === "object" && candidate !== null && "name" in candidate && candidate.name === name) return directory;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`无法定位依赖包：${name}`);
    directory = parent;
  }
}

async function copyLicenses(): Promise<void> {
  const notices = [`Dater 第三方组件声明\n\nBun ${Bun.version}：内置于 dater 可执行文件；见 licenses/bun/LICENSE。`];
  const seen = new Set<string>();
  const pending = Object.keys((await packageMetadata(project)).dependencies).map(name => ({ name, from: project }));
  const coreRoot = await packageRoot("@opentui/core", project);
  pending.push({ name: nativePackage, from: coreRoot });
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    const root = await packageRoot(next.name, next.from);
    if (seen.has(root)) continue;
    seen.add(root);
    const metadata = await packageMetadata(root);
    const files = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() &&
      /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name));
    if (!files.length) throw new Error(`依赖没有随包许可证，不能完成发布：${metadata.name}`);
    const directory = join(payload, "licenses", `${metadata.name.replaceAll("/", "__")}@${metadata.version}`);
    await mkdir(directory, { recursive: true });
    for (const file of files) await copyFile(join(root, file.name), join(directory, file.name));
    notices.push(`${metadata.name} ${metadata.version} (${metadata.license})\n许可证：licenses/${metadata.name.replaceAll("/", "__")}@${metadata.version}/`);
    for (const name of Object.keys(metadata.dependencies)) pending.push({ name, from: root });
  }
  const bunDirectory = join(payload, "licenses", "bun");
  await mkdir(bunDirectory, { recursive: true });
  await copyFile(resolve(bunLicensePath ?? ""), join(bunDirectory, "LICENSE"));
  await copyFile(join(project, "LICENSE"), join(payload, "LICENSE"));
  await writeFile(join(payload, "THIRD_PARTY_NOTICES.txt"), `${notices.join("\n\n")}\n`, "utf8");
}

const nativeAssets: BunPlugin = {
  name: "dater-relocatable-native-assets",
  setup(builder) {
    // OpenTUI contains literal dynamic imports for every supported platform.
    // Resolve all of them without requiring packages from another OS. The
    // release entry supplies OTUI_ASSET_ROOT before OpenTUI initialization.
    builder.onResolve({ filter: /^@opentui\/core-(?:darwin|linux|win32)-(?:x64|arm64)(?:-musl)?$/ }, args =>
      ({ path: args.path, namespace: "dater-native" }));
    builder.onLoad({ filter: /.*/, namespace: "dater-native" }, () => ({ loader: "js",
      contents: 'throw new Error("Dater native assets must be resolved through OTUI_ASSET_ROOT"); export default "";' }));
  },
};

// Only replace this platform's generated payload; other runner outputs remain.
await rm(payload, { recursive: true, force: true });
await mkdir(payload, { recursive: true });
for (const asset of assets) {
  const destination = join(payload, "assets", ...asset.key.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(asset.source, destination);
}
await copyLicenses();

const result = await Bun.build({
  entrypoints: [join(project, "scripts", "release-entry.ts")],
  target: "bun", format: "esm", packages: "bundle", splitting: false,
  minify: true, metafile: true, plugins: [nativeAssets],
  compile: {
    target: platform === "win32" ? "bun-windows-x64" : "bun-linux-x64-baseline",
    outfile: executable,
    autoloadDotenv: false, autoloadBunfig: false, autoloadTsconfig: false, autoloadPackageJson: false,
  },
});
if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`);
  throw new Error("独立可执行文件构建失败。");
}
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun", "bun:ffi"]);
for (const input of Object.values(result.metafile?.inputs ?? {})) {
  for (const imported of input.imports) {
    if (imported.external && !builtins.has(imported.path)) {
      throw new Error(`发布包仍依赖外部模块，不能分发：${imported.path}`);
    }
  }
}
if (platform === "linux") await chmod(executable, 0o755);
process.stdout.write(`已构建 ${platformName}-x64：${executable}\n已复制 ${assets.length} 个 OpenTUI 运行资源及第三方许可证。\n`);
