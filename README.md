# Dater

Dater 是用于原创世界观日历管理的终端应用（TUI）项目。

当前已完成首个可运行版本：支持世界观 JSON 保存、超大跨度自定义历法、公历闰年规则、现实农历映射、日程/节日和 OpenTUI 终端界面。产品边界与已裁定行为记录于 [产品需求文档](docs/requirements.md)。

## 技术栈

- TypeScript，启用严格类型检查。
- [OpenTUI Core](https://opentui.com/docs/getting-started/quickstart/)，直接使用 TypeScript 管理终端组件与事件。
- [lunar-typescript](https://github.com/6tail/lunar-typescript)，提供 1900–2100 年现实农历数据（MIT）。
- Bun，运行 TypeScript 并构建应用。
- pnpm 10，管理依赖并提交 `pnpm-lock.yaml`。

OpenTUI Core 自带终端渲染和布局能力。项目采用纯 TypeScript API；`web-tree-sitter` 是 OpenTUI Core 要求的对等依赖。

## 安装包

安装包目前支持 Windows x64 和 Linux x64，包含 Bun 编译的独立可执行文件、OpenTUI 运行资源和许可证。使用安装包无需另外安装 Node.js、Bun 或 pnpm。

Windows 运行 `dater-0.0.0-windows-x64-setup.exe`，默认安装到当前用户的 `%LOCALAPPDATA%\Programs\Dater`，无需管理员权限。安装器将目录加入当前用户 PATH；安装完成后打开新终端，即可在任意世界观目录执行 `dater`。升级不会重复追加 PATH，卸载只移除安装器添加的条目。

Linux 可选择适合发行版的安装包。下面以 `0.0.0` 为例，使用下载文件的实际版本号：

```sh
# Debian / Ubuntu
sudo apt install ./dater-0.0.0-linux-x64.deb

# Fedora / RHEL 等使用 RPM 的发行版
sudo dnf install ./dater-0.0.0-linux-x64.rpm
```

这两种包均提供 `/usr/bin/dater`，安装后可直接从任意目录执行 `dater`。

AppImage 可直接运行，也可安装到当前用户：

```sh
chmod +x ./dater-0.0.0-linux-x64.AppImage
./dater-0.0.0-linux-x64.AppImage --install
```

用户安装将镜像放到 `~/.local/share/dater/dater.AppImage`，创建 `~/.local/bin/dater`，并为当前 shell 注册 PATH；打开新终端后执行 `dater`。再次运行 `--install` 可更新应用。安装不会覆盖其他来源的同名用户命令。

在世界观目录中运行 `dater` 会加载该目录的 `date.json`；也可执行 `dater /path/to/world` 指定目录。安装、更新和卸载应用均不清理世界观数据。

## 源码运行与开发环境

- Node.js 26.4.0 或更高版本，用于运行 pnpm，满足当前 OpenTUI 包声明的 Node.js 环境要求。
- Bun 1.4.0 或更高版本，用于运行和构建终端应用。
- `package.json` 指定的 pnpm 10.17.1。
- 支持交互输入和 Unicode 的终端。中文界面需使用具有中文字形的字体。

```sh
pnpm install
```

OpenTUI 通过平台包提供预编译的原生终端渲染库，常规依赖安装无需本地 Zig 编译器。依赖安装与运行应在同一操作系统和架构下进行；Windows 原生环境与 WSL 环境不要共用 `node_modules`。

依赖由 pnpm 统一管理；Bun 只负责执行和构建，不运行 `bun install` 或生成第二份锁文件。

## 目录

```text
Dater/
├── docs/
│   └── requirements.md     # 用户裁定的产品需求与补充建议
├── .github/workflows/      # Windows / Linux 安装包构建
├── packaging/             # Inno Setup、Linux 包与 AppImage 安装入口
├── scripts/               # 独立可执行文件和安装包构建
├── src/
│   ├── index.ts            # 应用入口与退出恢复
│   ├── tui/                # 终端界面、输入、焦点与风险确认
│   ├── storage/            # 世界观 JSON 校验与原子保存
│   └── shared/             # 自定义历法、农历、日程与迁移预览
├── tsconfig.json           # TypeScript 配置
├── package.json
├── pnpm-lock.yaml
├── AGENTS.md
└── LICENSE
```

应用入口为 `src/index.ts`，负责初始化终端界面和连接领域逻辑与存储模块。

## 预设命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 使用 Bun 监听源码变化并重新启动终端应用 |
| `pnpm start` | 使用 Bun 运行 TypeScript 应用入口 |
| `pnpm typecheck` | 检查 TypeScript 类型 |
| `pnpm build` | 检查类型并输出 Bun 目标的 JavaScript 到 `dist/` |
| `pnpm build:release` | 构建当前 Windows / Linux x64 平台的独立可执行文件、资源与许可证 |
| `pnpm package:linux` | 将 Linux 发布目录打包为 `.deb`、`.rpm` 和 AppImage |

在项目目录中完成一次全局命令链接，即可在任意世界观目录运行 `dater`。链接仍依赖当前项目源码、已安装的依赖及 PATH 中的 Bun：

```sh
pnpm link --global
```

请确保 pnpm 的全局命令目录已加入 PATH；尚未设置时可运行 `pnpm setup`，然后重新打开终端。

在世界观目录中启动时，先加载该目录根部的 `date.json`：

```sh
cd /path/to/world
dater
```

也可以显式指定目录；该参数优先于终端当前目录：

```sh
dater /path/to/world
# 在项目目录开发运行时也可指定世界观目录
pnpm start /path/to/world
```

找到文件时直接加载；没有文件时提示填写世界观目录，填写后先检查已有配置，确认没有配置才进入首次创建。`pnpm start` 无参数检查其运行目录；需要在其他目录直接启动时使用 `dater`，避免 pnpm 的项目目录选择改变启动目录。`dater --help` 显示命令用法。

全部世界观内容保存在 `/path/to/world/date.json`，无需软件内部的目录记录。重新安装软件后，重新指定原世界观目录即可加载。每个世界观使用不同目录。

表单和列表均使用键盘操作：`Tab` 切换焦点，`Enter` 提交或打开，`Esc` 返回，`Ctrl+S` 保存。需要替换默认文本时可在输入框中按 `Ctrl+U` 清空。

## 日历与编辑

| 按键 | 操作 |
| --- | --- |
| `g` | 输入年份或 `年/月/日` 检索 |
| `←` / `→`、`↑` / `↓` | 前后一天、前后一个世界观星期 |
| `PgUp` / `PgDn`、`[` / `]` | 换月、换年 |
| `n` / `e` | 创建日程、管理全部日程与单次例外 |
| `h` | 管理世界观固定节日与农历节日 |
| `c` / `l` | 历法设置、农历基准与循环 |
| `i` | 查看完整日期、农历、节气和传统民俗节日 |
| `w` | 打开或创建其他世界观目录、重命名当前世界观 |
| `?` / `q` | 帮助、退出 |

日历中的日期可用鼠标左键点选，键盘快捷键仍可完成全部核心操作。在当日日程列表中按 `Esc` 返回日历；关闭对话框后恢复日历焦点，可继续使用方向键和快捷键。

默认提供完整公历月份、世纪闰年例外和对应的星期。日历从用户选择的日期开始浏览，不与现实“今天”绑定。年份支持负数、0 和最多 256 位整数，使用 `BigInt` 计算并以十进制字符串保存。数字月份与日号至少显示两位，如 `09/27`、`01`；年份保持原样，超过两位的数字完整保留。

月份天数、星期名称与数量、闰年周期及基准、闰日分配均可修改。闰年判断优先级为单年覆盖、正则、基础规则；重复命中不会叠加闰日。历法应用前展示闰年命中示例、日程与节日日期预览，必须按 `Ctrl+Y` 明确确认。

农历使用完整 1900–2100 农历年。需要指定唯一的数字农历年月日（含闰月标记）与世界观日期作为同一天，通过连续天数往前后映射。展示使用干支年、中文月日，例如“乙巳年八月十五 · 中秋节”，并显示映射日的节气和传统民俗节日。干支年以正月初一换年；内置节气和节日只读展示，不写入用户日程。

范围外显示“农历不可用”；开启循环后重复整段数据，并明确显示循环年号。循环日期、节气和节日均来自同一个样本日。选中日信息支持换行，窄终端可查看完整内容。

日程支持标题、备注、颜色、全天、定时、跨日和按日/周/月/年重复。重复日程可选择日期不存在时跳过或顺延，也可修改或取消单次。定时日程使用 24 小时制，跨日结束时间 `00:00` 不占用结束日期。

## 首版边界

- 最多 128 个月、64 个星期名称；每个月（含闰日）最多十亿天。月份数量由月份列表决定，年总天数由月份与闰日分配计算。
- 正则支持数字、负号、`\d`、`.`、字符组/数字范围、分组、交替和常见重复量词，以及首尾锚点。锚点配合交替需加括号，例如 `^(1|2)$`。不支持环视、回溯引用或匹配标志。
- 最多 8 条正则，每条 160 字符，有限重复次数最多 32，自动机最多 96 状态。组合正则时固定周期最多 400，过于复杂的组合会拒绝保存；未使用正则的固定周期可使用大整数。
- 风险预览包含所有需要顺延的已保存日期、当前浏览日期起 60 天的重复日程，以及 400 天内的节日日期。取消不会修改数据；若缩减月份造成跨日日程结束早于开始，会要求先调整该日程。
- 每次日程展开最多 2000 次；跨度与重复过密时显示明确错误。世界观文件最多 32 MiB，每个世界观的日程和节日各最多 10000 条。
- 安装包首版支持 Windows x64 和 Linux x64；终端宜至少 60 列、24 行，宽终端并排显示日历和当日日程，窄终端上下排列。

`pnpm build` 是开发构建，保留外部依赖，运行 `dist/` 的结果仍需 Bun、生产依赖和当前平台的 OpenTUI 原生库。发布构建将 Bun 编译进可执行文件，并将原生资源随安装包分发；定位资源时使用可执行文件的位置，保留调用终端的当前目录。

## 自动构建安装包

[GitHub Actions 工作流](.github/workflows/build.yml) 在推送 `main`、`master`、`v*` 标签，提交拉取请求或手动运行时构建 Windows / Linux x64 安装包。版本默认取 `package.json`；`v<SemVer>` 标签或手动填写版本可指定构建版本。

工作流上传 `dater-windows-x64` 和 `dater-linux-x64` 两个 Actions artifacts，不自动创建 GitHub Release。安装包输出到 `release/packages/`，文件名为 `dater-<版本>-windows-x64-setup.exe` 和 `dater-<版本>-linux-x64.{deb,rpm,AppImage}`。

发布构建在对应平台安装依赖后进行，输出 `release/windows-x64/` 或 `release/linux-x64/`。构建脚本要求 `DATER_BUN_LICENSE` 指向所用 Bun 版本的官方许可证，工作流负责准备该文件；包内同时保留项目 MIT 许可证、第三方声明和依赖许可证。Linux 打包使用 fpm 与 appimagetool，Windows 使用 Inno Setup；工作流准备对应工具。

## 世界观数据

每个世界观目录根部的 `date.json` 包含该世界观的历法、农历基准、日程与节日，保留内部稳定 ID 和格式版本。重命名不会改变 ID。切换目录前保存编辑，取消或读取失败时保留当前世界观。

保存先写同目录临时文件、刷新，再替换原文件；保存失败保留内存编辑并提示重试。只有文件不存在时才允许创建，格式损坏、无权限或超过大小限制时报告错误，不能自动覆盖。

兼容已有 `Date.json` 并沿用其路径；两种大小写文件同时存在时优先 `date.json`。固定文件不存在时检查旧 `dater_date/*.json`：单个有效世界观复制迁移，多个有效世界观列出名称与文件名供选择，保留所有原文件。旧文件全部无法读取时展示错误并阻止静默新建。

## 许可证

[MIT](LICENSE)
