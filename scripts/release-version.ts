import { appendFile, readFile } from "node:fs/promises";

export async function getReleaseVersion(): Promise<string> {
  const metadata: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof metadata !== "object" || metadata === null || !("version" in metadata) || typeof metadata.version !== "string") {
    throw new Error("package.json 缺少有效版本。");
  }
  const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME?.replace(/^v/, "") : undefined;
  const version = process.env.DATER_RELEASE_VERSION || process.env.DATER_VERSION_INPUT || tag || metadata.version;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (version.length > 128 || !match || match.slice(1, 4).some(part => Number(part) > 65535) ||
      match[4]?.split(".").some(part => /^0\d+$/.test(part))) {
    throw new Error("发布版本须为 SemVer，例如 1.0.0 或 1.0.0-beta.1；前三段均不得超过 65535。");
  }
  return version;
}

if (import.meta.main) {
  const version = await getReleaseVersion();
  const fileVersion = `${version.split(/[+-]/)[0]}.0`;
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nfile-version=${fileVersion}\n`);
  }
  process.stdout.write(`发布版本：${version}\n`);
}
