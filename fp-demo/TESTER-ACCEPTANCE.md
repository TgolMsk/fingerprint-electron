# 多实例工作台验收

验收日期：2026-09-27 UTC。运行内核：Electron 44.4.5 / Chromium 152.0.7977.130 / FP Kernel 0.1.0。

## 结果

- 工作台 0.3.0 端到端：**58/58 通过**。新增从工作台打开脚本管理窗口并传递四个实例与当前选择的检查；公开的重建验收见 [工作台日志](../fp-kernel/reports/release/validation-2.log)。
- 原三账号隔离和跨进程重启回归：**91/91 通过**。公开的重建验收见 [三账号日志](../fp-kernel/reports/release/validation-1.log)。
- SDK / 脚本 / MV2 / MV3：**45/45 通过**，含跨进程恢复，详见 [兼容性验收](../fp-sdk/COMPATIBILITY.md)。
- [完整窗口截图](../docs/assets/workbench-window.png)：三个原生内嵌页面在同一窗口内显示。
- 双击入口实测：根目录及 fp-demo 目录启动器可启动正式工作台；首次生成三个独立 seed；再次启动聚焦同一窗口。

工作台测试覆盖真实 UI 控件、并排边界及四实例布局、独立 localStorage、切换不刷新、当前与全部导航、前进后退和刷新、新实例语言时区、实际指纹采集、JSON 导出、IPC 来源校验及本地复制权限。三实例 Canvas / Audio / Rects 摘要分别不同，同一实例重复测量稳定。全局 CSS 与 RTL 干扰对照通过。

导出 JSON 与内存快照一致，仅 JSON 标准将字体 alphabeticBaseline 的 `-0` 序列化为 `0`；测试明确记录这六处规范化，没有其他数据差异。测试查询了复制权限，没有改写用户剪贴板。

双击验收发现 Electron 应用加载器不能依赖 `require.main === module`；已增加独立 `src/app.js` 应用入口。测试仍直接导入 `src/main.js`，不会误开正式工作台。

这些结果验证工作台功能及隔离性，不代表第三方指纹网站全部通过。现有内核差异见 [阶段 5 报告](../fp-kernel/reports/phase5/REPORT.md)。
