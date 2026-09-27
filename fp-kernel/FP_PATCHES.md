# FP_PATCHES — 补丁登记表

每加或改一个补丁，都在表里更新一行。升级遇到冲突时，先查这张表。

工作区约定：
- Electron 侧改动：`D:\e\src\electron`（fp-main 分支），导出到 `patches/electron/`
- Chromium 侧改动：`D:\e\src`，导出到 `patches/chromium/fp_*.patch`，按文件名顺序追加到 `.patches` 末尾
- 自有新文件源头：`src/`（blink 镜像 `third_party/blink/renderer/platform/fingerprint/`，shell 镜像 `shell/browser/fingerprint/`）
- 上游文件里只插 1~3 行钩子，标记 `// FP-HOOK`；全局搜索 `FP-HOOK` 列出全部注入点
- 命名：fp_00 基础设施；fp_1x P0 破绽类；fp_2x P1 伪装类；fp_3x/4x P2 噪声类

| 补丁 | 挂在哪个函数 | 作用 | 验证方式 | 最后验证版本 |
| --- | --- | --- | --- | --- |
| fp\_00\_config（chromium） | `NavigatorConcurrentHardware::hardwareConcurrency` | 配置读取单例（`--fp-config` → JSON → 单例）、`fp::Hook`、确定性噪声；首个钩子=核数 | tests/phase2/accept.js 全过 | v44.4.5 |
| fp\_00\_config（electron） | `Session::SetFingerprintConfig`、`AppendExtraCommandLineSwitches`、`node_bindings` versions | 按 Session 存配置并下发到该分区全部渲染进程；`process.versions.fpkernel` | tests/phase2/accept.js 全过 | v44.4.5 |
| fp\_10\_ua\_client\_hints（chromium） | `GetUserAgentBrandList`（brand 补 "Google Chrome"）、`ContentBrowserClient::GetUserAgentForBrowserContext` 两个新虚函数、`ServiceWorkerVersion` 启动参数 | brands 与真 Chrome 三品牌一致；SW 按分区取 UA/metadata | tests/phase3/accept\_ua.js 21/21 | v44.4.5 |
| fp\_10\_ua（electron） | `GetApplicationUserAgent`（去 Electron 后缀）、`WebContents::SetUserAgent`（metadata 按配置）、`GetClientHintsControllerDelegate`（每分区委托）、`fp_ua.cc`/`fp_client_hints_delegate.cc` 新文件 | UA 无 Electron 痕迹；userAgentData/Sec-CH-UA 头按配置；导航 CH 头链路打通 | 同上 | v44.4.5 |
| fp\_11\_window\_chrome（electron） | `ElectronRenderFrameObserver::DidInstallConditionalFeatures`；新文件 `chrome_object_bindings.cc`（照抄 M152 `chrome/renderer/loadtimes_bindings.cc`） | window.chrome = 真 Chrome（loadTimes 13 键、csi 4 键、app 7 键、native toString） | tests/phase3/accept\_chrome\_obj.js 17/17 | v44.4.5 |
| fp\_13\_webdriver\_always\_false（chromium） | `Navigator::webdriver`（`#if 1 return false`，原逻辑留 #else） | navigator.webdriver 恒 false | tests/phase3/accept\_tz.js | v44.4.5 |
| fp\_14\_lang（chromium） | `RenderProcessHostImpl::Init` 的 `--lang` 写入加 HasSwitch 守卫 | embedder 按分区指定的 --lang 不被浏览器区域覆盖 | tests/phase3/accept\_tz.js 15/15 | v44.4.5 |
| fp\_14\_timezone\_lang（electron） | `AppendExtraCommandLineSwitches`（追加 --lang）、`electron_api_web_contents.cc` accept\_languages、`GetAcceptLangs` 覆写、`RendererClientBase::RenderThreadStarted`（TimeZoneController::SetTimeZoneOverride 常驻 + ICU setDefault）、`ElectronMainDelegate::BasicStartupComplete`（fp\_locale.cc 纠正 ICU 区域归一化） | 时区/语言/Intl locale 按配置，四上下文一致 | 同上 | v44.4.5 |

| fp\_20\_navigator（chromium） | `NavigatorDeviceMemory`、`NavigatorID` | 设备内存与平台按配置，Window/Worker 一致 | accept_p1.js 20/20（与 fp_21/30 合测） | v44.4.5 |
| fp\_21\_screen（chromium） | `WebFrameWidgetImpl`、`LocalFrame`、`fingerprint_screen` | 屏幕、CSS media query、DPR 配置一致 | 同上 | v44.4.5 |
| fp\_30\_webgl（chromium） | WebGL getParameter、GPUAdapter | WebGL vendor/renderer 与 WebGPU 信息 | 同上 | v44.4.5 |
| fp\_31\_canvas（chromium） | Canvas readback、ImageDataBuffer、WebGL readPixels | 按 seed 确定性像素扰动 | accept_noise.js 8/8（与 fp_40 合测） | v44.4.5 |
| fp\_40\_audio（chromium） | AudioBuffer、RealtimeAnalyser、OfflineAudioContext | 确定性音频采样扰动 | 同上 | v44.4.5 |
| fp\_41\_rects\_text\_metrics（chromium） | Element/Range JS 返回层、DOMRect、TextMetrics | 双精度扰动；空/零几何、布局与原生构造器保持原样 | accept_rects.js 72/72；accept_p2.js 20/20 合测 | v44.4.5 |
| fp\_42\_font\_whitelist（chromium） | Windows CreateFontPlatformData、FontAccess | 解析真实字体后按 family 过滤；覆盖 local/PostScript/本地化别名；保留 CSS 回退 | accept_fonts.js 19/19；accept_p2.js 合测 | v44.4.5 |
| fp\_43\_media\_speech（chromium） | MediaDevices::DevicesEnumerated、SpeechSynthesis | 未授权枚举模板、媒体策略过滤；有 label 则保留原生设备；语音 URI 使用 Chromium 名称格式 | accept_media.js 5/5；accept_p2.js 合测 | v44.4.5 |

## 2026-09-26 最终验收

- 12 个 Chromium 补丁已在临时目录按顺序重放，41 个涉及文件与实际源码逐字节一致。
- 内核验收共 206 项通过；Demo 两次独立进程的三账号验收 91 项通过。
- [本地验收报告](reports/ACCEPTANCE.md)；[公开站点检测报告](reports/phase5/REPORT.md)。
- 当前 P2 聚合导出入口：`python scripts/export-p2.py`；校验入口：`python scripts/verify-patches.py --output test-results/patch-replay.json`。导出脚本基线是当前 v44.4.5 树中 fp_40 完成提交；升级后需显式传入对应 `--base`。

## 已知事项

- **ICU 区域归一化陷阱（fp_14 深挖结论）**：`LoadLocaleResources` 会把 `ja-JP` 这类
  `--lang` 按资源包归一化为 `ja` 并 `SetICUDefaultLocale`，且发生在 V8 固化
  default locale 之前。必须在 `BasicStartupComplete` 的 `LoadResourceBundle` 之后
  立即用 `forLanguageTag` 恢复完整区域（fp\_locale.cc），晚于此时机的修正无效。
- **fp\_12 plugins/PDF**：探查确认 Electron 官方构建默认即有与真 Chrome 相同的
  5 条 PDF 插件 + pdfViewerEnabled（`dom_plugin_array.cc`），无需补丁；阶段 5 复核。
- **微任务回调（fp\_11）**：从裸 `MicrotaskCallback` 回调 JS 必须
  `v8::MicrotasksScope(context, kRunMicrotasks)` + `Context::Scope`，否则 Testing
  构建 DCHECK 崩溃。
- **Accept-CH 持久化为内存级**（fp\_client\_hints\_delegate）：进程生命周期内有效，
  重启丢失；真 Chrome 持久化到 prefs。后续如需再补。
- **几何一致性**：旋转元素的 Element/Range 原生路径存在约 3e-5 的浮点差异；测试保留此基线关系，各接口自身扰动不超过 1e-5，避免把原生差异错误判为补丁失效。
- **字体模板**：白名单内字体仍需宿主机实际安装；模板不是字体文件包。字体测试以本机已安装、模板排除的 Cascadia Code 验证过滤，同时验证 Arial/Calibri/Consolas、中文别名、PostScript 名称和禁用配置。
- **媒体模板边界**：未授权列表为固定 2 麦、1 摄像头、2 输出的项目模板，不等于所有 Chrome 的原生未授权枚举形态。模板 ID 没有到物理设备的反向映射；指定 ID 采集/播放和实际 TTS 合成未验收。授权后已有 label 的设备列表保留原生行为。
- **公开检测**：确定性不代表不可检测；CreepJS 对音频、文本/几何扰动仍可能报 lies。以检测报告实际结果为准。
