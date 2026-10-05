import { link, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { Calendar } from "../shared/calendar.ts";
import { defaultCalendar } from "../shared/types.ts";
import { validateWorld } from "../shared/validation.ts";
import type { World } from "../shared/types.ts";

const FILE_NAME = "date.json";
const LEGACY_DIRECTORY = "dater_date";
const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
const safeId = (id: string): string => {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("世界观标识无效。");
  return id;
};

export class WorldStore {
  readonly directory: string;
  private dataFile: string;

  constructor(worldDirectory: string) {
    if (!worldDirectory.trim() || worldDirectory.includes("\0")) throw new Error("世界观目录不能为空或包含空字符。");
    const expanded = worldDirectory === "~" ? homedir() : /^~[\\/]/.test(worldDirectory) ? join(homedir(), worldDirectory.slice(2)) : worldDirectory;
    this.directory = resolve(expanded);
    this.dataFile = join(this.directory, FILE_NAME);
  }

  get filePath(): string { return this.dataFile; }

  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  async listLegacy(): Promise<{ worlds: { id: string; name: string }[]; errors: string[] }> {
    const directory = join(this.directory, LEGACY_DIRECTORY);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    const result: { id: string; name: string }[] = [];
    const errors: string[] = [];
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith(".json"))) {
      try {
        const parsed = await this.readJson(join(directory, entry.name));
        const world = validateWorld(parsed);
        if (entry.name !== `${world.id}.json`) throw new Error("文件名与世界观标识不一致。");
        result.push({ id: world.id, name: world.name });
      } catch (error) {
        errors.push(`${entry.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { worlds: result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), errors };
  }

  async load(): Promise<World | null> {
    const names = await readdir(this.directory).catch((error: unknown): string[] => {
      if (isMissing(error)) return [];
      throw error;
    });
    // Directory entries retain the actual spelling even on Windows/DrvFS,
    // where accessing date.json would also succeed for an existing Date.json.
    for (const name of [FILE_NAME, "Date.json"].filter(item => names.includes(item))) {
      const file = join(this.directory, name);
      try {
        const world = validateWorld(await this.readJson(file));
        this.dataFile = file;
        return world;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    this.dataFile = join(this.directory, FILE_NAME);
    return null;
  }

  async save(world: World): Promise<void> {
    await this.write(world, false);
  }

  private async write(world: World, createOnly: boolean): Promise<void> {
    const checked = validateWorld(world);
    const serialized = `${JSON.stringify(checked, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) throw new Error("世界观数据超过 32 MiB，编辑内容仍保留，请减少日程或备注后重试。");
    await this.initialize();
    const file = createOnly ? join(this.directory, FILE_NAME) : this.dataFile;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally { await handle.close(); }
      if (createOnly) {
        // Publishing a fully written file by hard link is atomic and refuses to
        // replace an existing target, unlike rename's replacement semantics.
        await link(temporary, file);
        this.dataFile = file;
      } else {
        await rename(temporary, file);
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async create(name: string): Promise<World> {
    await this.ensureAbsent();
    const id = randomUUID().replaceAll("-", "");
    const calendar = defaultCalendar();
    const world: World = { schemaVersion: 1, id, name: name.trim() || "未命名世界观", calendar,
      lunar: { anchor: null, cyclic: false }, events: [], holidays: [] };
    // Constructing these here makes creation fail before a file is written if a
    // future default becomes invalid.
    new Calendar(calendar);
    await this.write(world, true);
    return world;
  }

  async migrateLegacy(id: string): Promise<World> {
    await this.ensureAbsent();
    const file = join(this.directory, LEGACY_DIRECTORY, `${safeId(id)}.json`);
    const world = validateWorld(await this.readJson(file));
    if (world.id !== id) throw new Error("文件名与世界观标识不一致。");
    await this.write(world, true);
    return world;
  }

  private async ensureAbsent(): Promise<void> {
    if (await this.load()) throw new Error("该目录已有世界观数据，请打开现有世界观或选择其他目录。");
  }

  private async readJson(file: string): Promise<unknown> {
    const information = await stat(file);
    if (information.size > 32 * 1024 * 1024) throw new Error("世界观文件超过 32 MiB，请拆分数据后再打开。");
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  }
}
