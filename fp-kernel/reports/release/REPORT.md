# 可迁移构建与发布验证

日期：2026-09-27。目标：Windows x64 / Electron 44.4.5 / Chromium 152.0.7977.130 / Node 24.21.0 / FP Kernel 0.1.0。

## 当前结论

固定源码、工具版本、补丁顺序与校验值的流程已落地。独立目录中 159 个源码仓库的最终 Git tree 全部匹配，完整内核从空输出目录编译成功，编译后再次核对全部源码通过。新运行时在含中文和空格的路径下通过 400 项验收，实际安装与回退也已通过。

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 固定源码重放 | 159/159 tree 匹配；4 个 Electron、12 个 Chromium FP 补丁 | [source-verification.json](source-verification.json) |
| 自动采集候选锁 | 159 个仓库基线和最终 tree 与正式清单相同 | [lock-capture-check.json](lock-capture-check.json) |
| 工具版本与路径检查 | Node、Python、Git、MSVC、SDK 通过；Clang/Rust 在 build 中额外核对 | [toolchain.json](toolchain.json) |
| 流程失败处理单元测试 | 27/27 | [pipeline-tests.log](pipeline-tests.log) |
| 启动路径解析 | Node、Python、Windows PowerShell 对中文路径、相对路径、环境覆盖和配置优先级一致 | 同上单元测试，5 组实际路径场景 |
| PowerShell 入口失败中止 | 错误版本、非空目标目录分别阻止后续步骤；VERSION 与既有文件保留 | [wrapper-failures.json](wrapper-failures.json) |
| 新重建运行时迁移验收 | 内核 206、三账号 91、工作台 58、SDK 45，共 400 项通过；中文及空格路径运行正常 | [验收汇总](acceptance-summary.json)、[四组执行记录](validation-report.json) |
| 新包实际安装与回退 | 新包安装到不可覆盖目录，成功回到前一指针；测试账号数据哨兵未改变 | [install-rebuilt-rollback.json](install-rebuilt-rollback.json) |
| 在线远端标签查询 | 首次连接重置时安全中止；重试成功，标签提交与锁一致 | [失败记录](upstream-query-failure.json)、[重试结果](upstream-target-check.json) |
| 新目录完整编译 | 成功；原开发源码 HEAD 和工作树未改变 | [clean-rebuild.json](clean-rebuild.json) |
| 打包来源一致性 | 实际输出目录、GN 参数、官方发行 ZIP 及其中 73 个文件全部匹配 | 同上记录、运行时清单及打包检查 |

## 验证环境与边界

本次在原 Windows 主机上的新目录创建独立 Git 工作树与索引，重新应用全部补丁，构建输出从空目录开始。使用本机已下载的源码对象和构建依赖缓存，没有复用旧 `out/`、对象文件或运行时 EXE。此范围是“干净源码/输出重建”，不是“全新操作系统且完全无缓存联网下载”。

独立源码目录为 `D:/fp-rebuild-44.4.5-verified`；新包迁移验收目录为 `D:/fp 迁移验收-44.4.5`；安装回退目录为 `D:/fp-install-validation-44.4.5`。这些路径仅记录本次证据，脚本不将它们作为默认值。

本机为 i5-14600K、约 48 GB 内存。本次编译累计约 2 小时 57 分，包含失败恢复和 12 路调整到 18 路后的续编译，不含源码准备；这不是其他机器的耗时保证。中途调整并发后只续编译未完成的本次输出。

新生成的 `build.ninja`、`environment.x64`、`environment.x86` 未包含旧 `D:/e/src` 源码路径。Python 从独立 depot_tools 引导目录启动；Microsoft 工具链配置在新目录重新生成。

## 已实际暴露并修复的问题

1. `.gclient_previous_sync_commits` 部分记录为已打补丁的提交：改从 Electron 保存的原始 upstream ref 捕获基线，再核对所有最终 tree。
2. Git LFS 的 Android 资源下载返回 405：Windows 准备流程设置 `GIT_LFS_SKIP_SMUDGE=1`；首次部分 checkout 通过保留原目录的隔离恢复入口重建。
3. 只读 CIPD/Python 文件阻碍续跑：已有文件先比 SHA256，相同则保留，内容不同则停止。
4. 缓存准备缺少 GN 参数、LASTCHANGE/GPU/Skia/Dawn 版本文件：从固定 DEPS 和当前已校验源码重新生成。
5. 工具链配置携带旧目录：根据本次工作区重建 `win_toolchain.json`，由 Chromium 官方工具链脚本读取。
6. GN 导入下载测试数据中的 BUILD.gn：缓存目录清单覆盖 gclient 的非 Git 下载条目。
7. DevTools Windows Rollup 原生模块缺失：从固定 CIPD 二进制生成平台包，不执行浮动 npm 安装。
8. Windows Git 换行转换可能破坏已锁定补丁的 SHA256：添加 `.gitattributes`，并在 `core.autocrlf=true` 下实际克隆验证补丁与锁文件字节不变。
9. Windows PowerShell 5 在参数默认表达式中无法取得脚本目录：默认锁路径改为在参数绑定之后解析，并实际运行入口验证。
10. 显式传入工具链时，配置文件可能提前创建 `src/` 阻碍克隆：改为先创建检出，再生成源码目录中的工具链配置，并增加回归测试。
11. 重建目录再次作为缓存时可能丢失下载依赖登记：保留 `.gclient_entries` 中已复制的 CIPD 条目，并测试从第一份缓存连续准备第二份新目录。

## 本次重建产物

运行时原始产物：`dist/runtime-rebuilt/fp-electron-44.4.5-fp0.1.0-win32-x64-testing.zip`。

SHA256：`62d896545153da78ba74d7dac387da0a42da024e0ba2f2c45cf26503be52de4b`。

大小为 210,490,153 字节，约 200.74 MiB。包含 73 个运行时文件，另附内嵌版本/逐文件校验清单与源码锁。真实启动探测确认 Electron 44.4.5、Chromium 152.0.7977.130、Node 24.21.0、FP Kernel 0.1.0 及原生 `setFingerprintConfig` 接口。四组验收使用的正是这份新 ZIP。

完整交付目录为 `dist/release-44.4.5-fp0.1.0/`，包含运行时 ZIP、整包 SHA256、四组验收报告、运行时清单、源码 ZIP、源码逐文件清单与 `SHA256SUMS`。先前 `dist/runtime/`、`dist/runtime-locked/` 和 `dist/release-existing-44.4.5-fp0.1.0/` 是历史测试样本，不作为本次交付。

首次无缓存联网下载未完成验证。GitHub 远端标签查询首次遇到连接重置，后续重试成功，返回的 v44.4.5 提交与锁相同；本次完整重建仍使用固定本机缓存。

当前流程没有执行 GitHub 推送、公开发布或 Windows 代码签名；仓库未配置远端。本次产物采用锁定的 testing 配置，不是已验证的优化 release 配置或安装器。SHA256 用于完整性，不替代发布者签名。更换系统、CPU 架构、编译配置或 Electron 版本均需重新验收。

使用步骤见 [构建迁移与发布](../../../docs/构建迁移与发布.md)。
