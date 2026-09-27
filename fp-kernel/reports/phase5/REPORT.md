# 阶段 5 检测报告

运行标签：**final**。采集时间：2026-09-27T03:00:35.158Z 至 2026-09-27T03:04:01.139Z（UTC）。

结论：Sannysoft 的 3 个虚构账号均观察到 31 项通过、0 项失败。CreepJS 检出 lies，不能判定为全部通过。本次两个站点主页面均可访问。同版本真 Chrome 152 对照尚未测试。

## 环境与复现

- 内核：Electron 44.4.5 / Chromium 152.0.7977.130 / fpkernel 0.1.0。
- 可执行文件：`D:\e\src\out\Testing\electron.exe`；文件修改时间：2026-09-27T02:59:28.943Z。
- 可执行文件 SHA256：`139ac6b0756bfcd26171e23f77527756208f9102e7f03c47ea75056dffbc8eb8`；构建侧报告的修复提交：`963dd4b8e17d1`。Hash 在采集结束后 2026-09-27T03:04:32.756Z 复核。
- 独立临时 userData：`C:\Users\51129\AppData\Local\Temp\fp-phase5-RundmW`；固定虚构账号，直连，无真实账户、登录或验证码交互。
- 公共页面：[CreepJS](https://abrahamjuliot.github.io/creepjs/)、[Sannysoft](https://bot.sannysoft.com/)。
- 浏览器设置：plugins:true、sandbox、contextIsolation、nodeIntegration:false；禁用非代理 WebRTC UDP；未授权摄像头、麦克风或字体访问。
- 采集器为隐藏 BrowserWindow，1440×1100 设定视口，无 Demo 翻译 preload，明确拒绝全部权限；这些设置与真实 Demo 的窗口和权限行为可能不同，不能把这里的结果替代 Demo 本身验收。
- [复现说明](../../tests/phase5/README.md)、[原始 manifest](2026-09-27T03-00-35-062Z/manifest.json)、[结构化汇总](2026-09-27T03-00-35-062Z/summary.json)。

## 真实站点结果

| 虚构账号 | 站点 | 采集状态 | 站点结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | CreepJS | COLLECTED | 4 lies；31% like headless / 0% headless / 0% stealth | [原始结果](2026-09-27T03-00-35-062Z/creepjs-account-1.fingerprint.json) · [截图](2026-09-27T03-00-35-062Z/creepjs-account-1.png) |
| 1 | Sannysoft | COLLECTED | 31 passed / 0 failed / 0 warning | [原始结果](2026-09-27T03-00-35-062Z/sannysoft-account-1.page.json) · [截图](2026-09-27T03-00-35-062Z/sannysoft-account-1.png) |
| 2 | CreepJS | COLLECTED | 4 lies；31% like headless / 0% headless / 0% stealth | [原始结果](2026-09-27T03-00-35-062Z/creepjs-account-2.fingerprint.json) · [截图](2026-09-27T03-00-35-062Z/creepjs-account-2.png) |
| 2 | Sannysoft | COLLECTED | 31 passed / 0 failed / 0 warning | [原始结果](2026-09-27T03-00-35-062Z/sannysoft-account-2.page.json) · [截图](2026-09-27T03-00-35-062Z/sannysoft-account-2.png) |
| 3 | CreepJS | COLLECTED | 4 lies；31% like headless / 0% headless / 0% stealth | [原始结果](2026-09-27T03-00-35-062Z/creepjs-account-3.fingerprint.json) · [截图](2026-09-27T03-00-35-062Z/creepjs-account-3.png) |
| 3 | Sannysoft | COLLECTED | 31 passed / 0 failed / 0 warning | [原始结果](2026-09-27T03-00-35-062Z/sannysoft-account-3.page.json) · [截图](2026-09-27T03-00-35-062Z/sannysoft-account-3.png) |

`COLLECTED` 和采集进程退出码 0 仅表示结果已保存。Sannysoft 的 passed 来自实际 DOM 类名；CreepJS 的 lies 来自站点在 console 输出的 Loose Fingerprint JSON。没有把本地 PASS 或页面功能模块的 passed 日志当作外部全绿。

## CreepJS 检出的差异

| 虚构账号 | API | 站点原始判断 |
| --- | --- | --- |
| 1 | Element.getClientRects | failed math calculation; unknown rotate dimensions |
| 1 | AudioBuffer | audio is fake; sample noise detected |
| 2 | Element.getClientRects | failed math calculation; unknown rotate dimensions |
| 2 | AudioBuffer | audio is fake; sample noise detected |
| 3 | Element.getClientRects | failed math calculation; unknown rotate dimensions |
| 3 | AudioBuffer | audio is fake; sample noise detected |

- 账号 1：like-headless 触发项为 `notificationIsDenied`、`noWebShare`、`noContentIndex`、`noContactsManager`、`noDownlinkMax`；trash 0 项，capturedErrors 0 项。
- 账号 2：like-headless 触发项为 `notificationIsDenied`、`noWebShare`、`noContentIndex`、`noContactsManager`、`noDownlinkMax`；trash 0 项，capturedErrors 0 项。
- 账号 3：like-headless 触发项为 `notificationIsDenied`、`noWebShare`、`noContentIndex`、`noContactsManager`、`noDownlinkMax`；trash 0 项，capturedErrors 0 项。
- `notificationIsDenied` 与本次明确拒绝权限的采集设置有关；其余分值按站点原样保留。0% headless 或 0% stealth 不能抵消 lies。

## plugins / PDF / window.chrome 复核

本轮 6 个成功采集页面均记录了 API 原值。首个页面：webdriver=false；PDF 插件 5 项；mimeTypes 2 项；pdfViewerEnabled=true；window.chrome 键 loadTimes, csi, app；loadTimes 13 键，csi 4 键，app 7 键；loadTimes/csi 为 native 函数文本。逐页数据见 `*.probe.json`。

逐页核验：webdriver=false 6/6；五个标准 PDF 插件、两个 MIME type 和 pdfViewerEnabled=true 6/6；chrome 三键、13/4/7 子键数及 native 文本 6/6。这是内核结果自身的形状核验，尚未与同版本真 Chrome 对照。

插件名称：PDF Viewer；Chrome PDF Viewer；Chromium PDF Viewer；Microsoft Edge PDF Viewer；WebKit built-in PDF。

**尚未测试**：与同版本、同系统真 Chrome 152 的属性描述符、键顺序、函数名称及行为逐项对照；当前没有匹配基准浏览器。插件枚举通过也不等于已验收 PDF 文档实际加载/打印。

已检查本机常用安装路径：`C:\Program Files\Google\Chrome\Application\chrome.exe` 的 ProductVersion 为 **154.0.8037.57**，与本次内核的 Chromium 152 不同，因此未将其作为同版本对照。

## 网络、错误与覆盖范围

- sannysoft-account-1: `net::ERR_FAILED`，wss://bot.sannysoft.com/itsgonnafail
- sannysoft-account-1: `net::ERR_BLOCKED_BY_ORB`，https://intoli.com/nonexistent-image.png
- sannysoft-account-1: `net::ERR_CONNECTION_TIMED_OUT`，https://mc.yandex.ru/metrika/tag.js
- sannysoft-account-2: `net::ERR_BLOCKED_BY_ORB`，https://intoli.com/nonexistent-image.png
- sannysoft-account-2: `net::ERR_FAILED`，wss://bot.sannysoft.com/itsgonnafail
- sannysoft-account-2: `net::ERR_CONNECTION_TIMED_OUT`，https://mc.yandex.ru/metrika/tag.js
- sannysoft-account-3: `net::ERR_BLOCKED_BY_ORB`，https://intoli.com/nonexistent-image.png
- sannysoft-account-3: `net::ERR_FAILED`，wss://bot.sannysoft.com/itsgonnafail
- sannysoft-account-3: `net::ERR_CONNECTION_TIMED_OUT`，https://mc.yandex.ru/metrika/tag.js
- Sannysoft 的不存在图片和 itsgonnafail WebSocket 是故意失败的检测目标；保留其网络错误，不将其误记为主站不可达。其他子资源错误同样保留。
- 站点 console 中无参 sendBeacon / getUserMedia 等异常保留在 manifest；本报告不隐藏站点或内核警告。
- 本轮未测试真实设备采集、指定模板 deviceId 的 exact 选设备、实际 TTS 合成、外部账号登录、代理国家/IP 匹配或真实账户风控。媒体枚举模板不代表可用物理设备，语音模板不代表对应语音引擎实际可发声。
- CreepJS 的特征版本库在本次 console 中以 Chrome 115 特征对照 Chrome 152；不将其 Features 113–115+ 展示误当成内核实际版本。
- 检测站点随时可能改变；该报告仅覆盖证据目录所记录的本次运行。
