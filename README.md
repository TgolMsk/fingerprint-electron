# FP Lab · Fingerprint Electron

**定制指纹 Electron / Chromium 内核、多账号嵌入 SDK 与多实例工作台。**

FP Lab is a custom Electron/Chromium fingerprint runtime and an embedding SDK for building fingerprint browsers and multi-account desktop panels. It provides isolated browser sessions, per-instance fingerprint profiles, JavaScript script management, unpacked Chrome extension support, and a version-locked build and release workflow for Windows x64.

本项目提供定制 Electron/Chromium 指纹内核、可复用的主进程 SDK 和桌面多实例工作台，供二次开发指纹浏览器或多账号嵌入面板。支持独立实例、脚本管理、解压扩展按实例加载，并提供指纹检测与验收工具。

**完整操作说明：[项目使用手册](docs/项目使用手册.md)。**

## 立即使用

**Windows x64 运行时下载：[v44.4.5-fp0.1.0-testing.1 预发布版](https://github.com/TgolMsk/fingerprint-electron/releases/tag/v44.4.5-fp0.1.0-testing.1)。** 运行时约 201 MiB，Electron 程序和定制 Chromium 内核包含在同一个完整包中。下载、校验、安装及接入现有应用见 [运行时下载与接入](docs/运行时下载与接入.md)。当前为 `testing` 配置，尚未提供优化 `release` 构建或安装器。

```powershell
git clone https://github.com/TgolMsk/fingerprint-electron.git
cd fingerprint-electron
git checkout v44.4.5-fp0.1.0-testing.1
```

源码仓库不包含 `electron.exe`、Chromium 完整源码或编译缓存。启动前需按 [构建迁移与发布](docs/构建迁移与发布.md) 安装已校验的定制运行时包，或在独立目录自行编译。普通 `npm install electron` 不能替代定制内核。

双击 [启动指纹测试.cmd](启动指纹测试.cmd)。首次启动默认创建三个实例，支持最多六个实例、单实例/并排布局、检测站快捷入口及 JSON 导出。

顶部点击 **脚本与扩展**，可以导入/编辑 JS、按实例手动或页面加载后执行、查看结果与错误；也可导入解压扩展目录、按实例启停、打开弹窗和恢复重启状态。旧工作台需正常退出后重新打开以载入更新。

二次开发从 [SDK 接入指南](fp-sdk/README.md) 和 [双账号嵌入示例](fp-sdk/examples/embedded.js) 开始。

启动器按环境变量、`runtime/current.json`、本机 `.fp-local.json`、`runtime/electron.exe` 的顺序定位定制运行时。换机器按 [构建迁移与发布](docs/构建迁移与发布.md) 安装已校验运行时包；安装完成后直接启动不需要 Node.js 或重新编译。

若使用终端启动：

```powershell
# 在项目根目录
npm --prefix fp-demo start
```

## 文档导航

| 内容 | 入口 |
| --- | --- |
| GitHub Releases 下载、校验安装、现有 Electron 应用接入 | [运行时下载与接入](docs/运行时下载与接入.md) |
| 换机器、版本锁定、重建、打包、校验、升级回退 | [构建迁移与发布](docs/构建迁移与发布.md) |
| 自托管 runner 构建、草稿 Release 与下游下载校验 | [自托管构建流水线](docs/自托管构建流水线.md) |
| 启动、界面、实例设置、数据备份、常见问题 | [项目使用手册](docs/项目使用手册.md) |
| 脚本导入、执行、扩展管理、手动复核 | [脚本与扩展使用指南](docs/脚本与扩展使用指南.md) |
| 嵌入接口、生命周期、API、打包与二次开发 | [FP SDK README](fp-sdk/README.md) |
| MV2 / MV3 扩展能力及 SDK 验收 | [兼容性报告](fp-sdk/COMPATIBILITY.md) |
| 手动验收记录空表 | [测试记录模板](docs/测试记录模板.md) |
| 工作台简明说明 | [fp-demo/README.md](fp-demo/README.md) |
| 工作台 58 项验收及截图 | [工作台验收记录](fp-demo/TESTER-ACCEPTANCE.md) |
| 内核 206 项与三账号 91 项验收 | [内核本地验收报告](fp-kernel/reports/ACCEPTANCE.md) |
| Sannysoft / CreepJS 实际结果 | [公开检测报告](fp-kernel/reports/phase5/REPORT.md) |
| 内核补丁、规格与维护状态 | [补丁登记表](fp-kernel/FP_PATCHES.md) · [内核阶段进度](fp-kernel/STATUS.md) |

## 当前版本与结论

工作台 `0.3.0`、SDK `0.1.0`；已有验收构建为 Electron `44.4.5` / Chromium `152.0.7977.130` / FP Kernel `0.1.0`。

SDK 与跨进程恢复 **45/45**、工作台 **58/58**、三账号回归 **91/91** 通过。自建 MV2/MV3 扩展的页面注入、后台通信、弹窗、独立 local storage 和重启恢复均已实测；尚未验收具体商业插件，不代表全部 Chrome 扩展 API 可用。

本地功能与隔离验收已通过。此前公开检测中，Sannysoft 三个测试实例各 `31/31`；CreepJS 各有 `4 lies`，集中在 Rects 与 Audio。**项目功能完成和公开检测全通过是两种结论，当前不能宣称所有指纹检测均已通过。** 具体适用环境与未测范围以报告为准。

可迁移构建流程固定 159 个源码仓库及工具链版本；新运行时已从独立源码、空输出目录重建，并通过 **400 项功能验收、27 项流程测试**。使用固定下载缓存，未验证全新 Windows 无缓存下载。详见 [构建发布验证报告](fp-kernel/reports/release/REPORT.md)。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `fp-kernel/` | Electron / Chromium C++ 补丁、版本锁、构建发布脚本、内核测试 |
| `fp-sdk/` | 多实例嵌入、脚本管理、扩展管理、TypeScript 类型与接入示例 |
| `fp-demo/` | 基于 WebContentsView 的多实例桌面工作台 |
| `scripts/` | 可迁移运行时路径解析 |
| `docs/` | 使用手册、迁移构建、兼容性和验收说明 |

## 项目关键词

Electron、Chromium、browser fingerprinting、fingerprint browser、multi-account、embedded browser、session isolation、Chrome extensions、JavaScript automation、browser SDK；定制指纹内核、指纹浏览器二次开发、多账号面板、内嵌浏览器、脚本与扩展管理。
