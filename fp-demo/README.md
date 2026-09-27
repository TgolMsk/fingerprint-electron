# FP Lab · 多实例指纹测试

基于定制 Electron 内核的桌面指纹测试工作台。每个实例是窗口内真正独立的 WebContentsView，使用各自的持久化 Session、Cookie、存储和指纹 seed。切换视图不会刷新页面。

当前版本 `0.3.0`，已接入 [FP SDK](../fp-sdk/README.md)。顶部“脚本与扩展”提供 JS 导入/编辑、实例选择、手动/加载后执行、日志，以及解压扩展目录导入、按实例启停、弹窗、卸载和重启恢复。详见 [脚本与扩展使用指南](../docs/脚本与扩展使用指南.md) 和 [实际兼容性报告](../fp-sdk/COMPATIBILITY.md)。

完整操作、数据备份、检测结果判断及开发维护步骤见 [项目使用手册](../docs/项目使用手册.md)；手动复核可复制 [测试记录模板](../docs/测试记录模板.md)。

## 启动

双击项目根目录或本目录中的 **启动指纹测试.cmd** 即可打开程序，不需要安装依赖，也不需要 Node.js。运行时由环境变量或项目相对配置定位，换机器先按 [构建迁移与发布](../docs/构建迁移与发布.md) 安装运行时包。

也可以使用 Node.js 启动：

```powershell
# 在项目根目录
npm --prefix fp-demo start
```

可通过 `FP_DEMO_ELECTRON` 环境变量指定另一个定制内核。普通 Electron 缺少 `session.setFingerprintConfig`，程序会提示启动失败。重复启动会聚焦现有窗口。

## 手动验证

1. 首次启动创建三个实例，默认并排显示本地检测页。已有实例会保留原有配置和最后访问的网址。
2. 在顶部选择本地指纹、CreepJS、Sannysoft 或 BrowserLeaks。勾选“同步全部”后，检测站快捷按钮会让所有实例打开该站点。地址栏“打开”仍只操作当前实例，输入网址后需点击“全部打开”才能同步所有实例。
3. 侧栏选中实例，再切换单实例视图，方便查看完整的第三方检测结果。并排模式下每个页面可分别滚动、点击和操作。
4. 点击读取指纹，查看当前实例的实际浏览器读数；导出 JSON 会重新采集并保存配置、实际读数、采集时间及内核版本。
5. 新增实例可设置名称、语言、时区，以及 Canvas、Audio、Rects 噪声开关。最多同时运行六个实例，创建后配置和 seed 固定保留。

本地检测页展示 UA / Client Hints、语言和时区、屏幕、WebGL、Canvas、离线音频、Rects、文字测量、PDF 插件、语音列表和媒体设备。支持重测、复制及下载 JSON。不同 seed 的 Canvas / Audio / Rects 摘要可用来比较隔离效果；摘要不是第三方检测通过率。

本地页使用临时 loopback 端口；重启后 origin 可能变化，因此媒体设备 ID 等与 origin 相关的数值应在同一检测站点下比较。几何与字体对照也应保持相同页面和缩放设置。

工作台不申请摄像头、麦克风或定位权限；媒体设备是在未授权状态下枚举，离线音频不会播放声音。外部检测站需要网络连接。三个实例默认显式直连，不继承系统代理规则，共用本机网络出口；本程序界面不配置代理。

## 数据位置

- 实例配置：`%APPDATA%\fp-demo\accounts.json`。关闭程序再打开会继续使用同一 seed。
- 各实例浏览器数据：同一 userData 目录的 `Partitions\acc-<实例 ID>`。
- 脚本、扩展登记、导入副本和执行日志：同一 userData 目录的 `automation`。
- 工作台导出：本目录 `exports\fingerprint-<实例 ID 前 8 位>-<时间戳>.json`。导出后可从界面打开所在目录。

程序不会自动删除已有实例数据。需要全新测试环境时，关闭程序后先备份上述 userData 目录，再使用新的目录启动：

```powershell
node fp-demo/scripts/start.js --user-data-dir="$((Join-Path $PWD 'profiles/fresh-test'))"
```

已知内核检测差异记录在 [阶段 5 检测报告](../fp-kernel/reports/phase5/REPORT.md)；此前 CreepJS 的 Rects / Audio 共四项 lies 尚未消除。本工具帮助复核实际表现，不更改第三方检测结果。

## 工作台自动验收

```powershell
npm run test:tester
```

覆盖真实界面操作、三实例并排布局、独立存储、当前/全部导航、前进后退和刷新、新实例语言时区、实际指纹采集、JSON 导出及 IPC 调用来源校验。结果与界面截图保存到 `test-results/tester-<UTC 时间>/`。

本次验收结果、完整窗口截图及启动入口验证见 [工作台验收记录](TESTER-ACCEPTANCE.md)。

## 三账号自动验收

```powershell
npm run test:acceptance
```

测试使用真实 `src/main.js`、账号存储、指纹生成器、侧栏页面及 preload/IPC。启动两个独立 Electron 进程，第二次复用测试专属 userData 和同一 localhost 页面，验证存储、指纹和账号重启持久性。不会使用正常 Demo 的账号文件，不会登录外部服务。临时数据保留在系统临时目录中，以便复核；路径记录在 JSON 报告中。

每次运行将 `summary.json`、分阶段 JSON 和 stdout/stderr 写入 `test-results/<UTC 时间>/`。失败返回非零退出码。覆盖范围和已知限制见 [阶段 4 验收记录](ACCEPTANCE.md)。

测试均使用独立的临时 userData，不影响手动测试的实例。

## SDK 与扩展验收

```powershell
npm run test:sdk
```

真实运行 MV2/MV3 测试扩展、脚本与管理界面，再启动第二个进程复核恢复和存储隔离。结果保存在 `../fp-sdk/test-results/<UTC 时间>/`。工作台源码需要与 `fp-sdk` 保持同级目录；迁移时应一起复制。
