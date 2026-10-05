import { chmod, copyFile, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getReleaseVersion } from "./release-version.ts";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Linux 安装包须在 Linux x64 runner 上制作。");
}
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = join(project, "release", "linux-x64");
const packages = join(project, "release", "packages");
const appDirectory = join(project, "release", "AppDir");
const version = await getReleaseVersion();
const appImageTool = process.env.DATER_APPIMAGETOOL;
if (!appImageTool || !resolve(appImageTool).startsWith("/") || !(await stat(appImageTool)).isFile()) {
  throw new Error("请设置 DATER_APPIMAGETOOL，指向已解包的 appimagetool AppRun。");
}
if (!(await stat(join(payload, "dater"))).isFile()) throw new Error("请先运行 pnpm build:release。");

interface PackageContent {
  src: string;
  dst: string;
  file_info: { mode: number };
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`发布目录中出现非普通文件：${path}`);
  }
  return files;
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: project, env: { ...process.env, ARCH: "x86_64" }, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command[0]} 打包失败，退出码 ${code}。`);
}

await mkdir(packages, { recursive: true });
const contents: PackageContent[] = (await listFiles(payload)).map(src => ({
  src, dst: `/usr/lib/dater/${relative(payload, src)}`,
  file_info: { mode: relative(payload, src) === "dater" ? 0o755 : 0o644 },
}));
contents.push(
  { src: join(project, "packaging/linux/dater.sh"), dst: "/usr/bin/dater", file_info: { mode: 0o755 } },
  { src: join(project, "packaging/linux/dater.desktop"), dst: "/usr/share/applications/dater.desktop", file_info: { mode: 0o644 } },
  { src: join(project, "packaging/linux/dater.svg"), dst: "/usr/share/icons/hicolor/scalable/apps/dater.svg", file_info: { mode: 0o644 } },
);
const repository = process.env.GITHUB_REPOSITORY;
const configuration = {
  name: "dater", arch: "amd64", platform: "linux", version,
  section: "utils", priority: "optional", license: "MIT", maintainer: "Dater contributors",
  description: "Dater - terminal calendar manager for fictional worlds.",
  ...(repository ? { homepage: `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}` } : {}),
  overrides: { deb: { depends: ["libc6 (>= 2.35)"] }, rpm: { depends: ["glibc >= 2.35"] } },
  contents,
};
// JSON is valid YAML; no extra serializer or application dependency is needed.
const configurationPath = join(project, "release", "nfpm.json");
await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`);
for (const format of ["deb", "rpm"]) {
  await run(["nfpm", "package", "--config", configurationPath, "--packager", format,
    "--target", join(packages, `dater-${version}-linux-x64.${format}`)]);
}

await rm(appDirectory, { recursive: true, force: true });
await mkdir(join(appDirectory, "usr/lib/dater"), { recursive: true });
await cp(payload, join(appDirectory, "usr/lib/dater"), { recursive: true });
for (const name of ["AppRun", "install-appimage.sh", "dater.desktop", "dater.svg"]) {
  await copyFile(join(project, "packaging/linux", name), join(appDirectory, name));
}
await copyFile(join(appDirectory, "dater.svg"), join(appDirectory, ".DirIcon"));
for (const path of ["AppRun", "install-appimage.sh", "usr/lib/dater/dater"]) {
  await chmod(join(appDirectory, path), 0o755);
}
await run([resolve(appImageTool), appDirectory, join(packages, `dater-${version}-linux-x64.AppImage`)]);
process.stdout.write(`Linux 安装包已生成：${packages}\n`);
