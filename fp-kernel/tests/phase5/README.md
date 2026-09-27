# 阶段 5：公开检测页证据采集

用已构建的自定义 Electron 运行，不编译、不读取 Demo 真实账号。脚本为每次运行新建系统临时 userData，使用固定虚构账号和独立 session，直连两个公开站点，无登录、无验证码交互。脚本仅读取页面结果和浏览器 API，不修改站点检测或网页 API。

```powershell
$env:FP_PHASE5_LABEL = 'final'
$env:FP_PHASE5_ACCOUNTS = '3'
node 'D:\project\webtt\fp-kernel\tests\phase5\run.js'
```

可选环境变量：`FP_ELECTRON` 指定自定义内核可执行文件（默认 `D:\e\src\out\Testing\electron.exe`）；`FP_PHASE5_OUTPUT` 指定独立输出目录；`FP_PHASE5_SETTLE_MS` 指定页面导航结束后的等待时间（默认 45 秒）；默认只检测 1 个虚构账号。Node 启动器等待 Windows GUI 进程结束并保存退出码和日志。

输出 `fp-kernel/reports/phase5/<UTC 时间>/manifest.json`、每个站点/账号的原始页面文本、结构化表格、API 探测结果、配置和截图。`COLLECTED` 仅表示证据采集完成，**不表示站点检测通过**；进程退出码 0 同样仅表示采集成功。最终结论须读取页面结果。主框架导航失败单列 `SITE_UNREACHABLE_OR_NAVIGATION_FAILED`，子资源错误保留在 `failedRequests`。

采集结束后，用生成的实际运行目录更新 `reports/phase5/REPORT.md`（同时写入该目录的 `summary.json`）：

```powershell
node 'D:\project\webtt\fp-kernel\tests\phase5\summarize.js' '<实际运行目录>'
```

CreepJS 判断取自站点自身在 console 输出的 Loose Fingerprint JSON，脚本另存为 `*.fingerprint.json`，不会仅凭 headless/stealth 为 0% 判定通过。Sannysoft 统计取自真实 DOM 的 passed/failed/warning 状态。站点改版后如果没有足够可识别结果，保持待复核状态。

设置与 Demo 共同部分：真实 Chromium 版本 UA、`plugins:true`、sandbox、contextIsolation、禁用 Node、直连、`disable_non_proxied_udp`。本采集器使用隐藏 BrowserWindow、1440×1100 视口，无 Demo 翻译 preload，并明确拒绝全部权限；这些差异会影响屏幕/权限等站点评分，需要在结论中保留。不会读取或修改真实 Demo 账户。

Chrome 152 基准对照默认标记 **NOT TESTED**。内核 API 形状、native 函数文本或 PDF 五插件存在性检查，不能代替与同版本真 Chrome 的逐项对照。临时 userData 的路径在 manifest 中，脚本不主动删除证据或用户文件。
