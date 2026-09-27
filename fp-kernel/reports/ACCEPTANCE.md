# 指纹内核本地验收报告

2026-09-26（America/New_York）。本地内核 **206/206**、Demo 三账号 **91/91** 通过。共 **297** 项断言。公开检测站的判断独立见 [阶段 5 报告](phase5/REPORT.md)。

## 构建与证据

- Electron **44.4.5**、Chromium **152.0.7977.130**、fpkernel **0.1.0**，Windows Testing 构建。
- 可执行文件：`D:\e\src\out\Testing\electron.exe`。
- SHA-256：`139ac6b0756bfcd26171e23f77527756208f9102e7f03c47ea75056dffbc8eb8`。
- 本次修复提交：Chromium `963dd4b8e17d1`；源码基线已有 fp_41/42/43 实现，本提交为验收发现的问题修复。
- [内核最终汇总及逐项日志](acceptance/summary.json)、[Demo 最终汇总](acceptance/demo-summary.json)、[补丁重放证据](acceptance/patch-replay.json)。
- 内核每个脚本使用独立临时 userData；Demo 两次进程共用专门创建的测试目录，以验证持久性。没有读取或修改日常账号数据。

## 内核断言

| 验收脚本 | 内容 | 结果 |
| --- | --- | --- |
| phase2/accept.js | API、版本、Session 配置、Window/跨站 iframe/Worker、无配置 | 9/9 |
| phase3/accept_chrome_obj.js | window.chrome 对象 | 17/17 |
| phase3/accept_ua.js | UA、Client Hints、上下文一致性 | 21/21 |
| phase3/accept_tz.js | 时区、语言、Intl、webdriver | 15/15 |
| phase3/accept_p1.js | navigator、screen/CSS/DPR、WebGL/WebGPU | 20/20 |
| phase3/accept_noise.js | Canvas/Audio 重复读取及账号间差异 | 8/8 |
| phase3/accept_p2.js | rects/字体/媒体/语音综合及同 seed 跨 renderer | 20/20 |
| phase3/accept_fonts.js | 原生字体、回退、中文别名、local/PostScript、关闭与未知模板 | 19/19 |
| phase3/accept_media.js | 媒体权限策略、关闭、授权后原生设备、voiceURI | 5/5 |
| phase3/accept_rects.js | 大坐标、四个几何 API、零/空、布局、Offscreen、关闭 | 72/72 |
| **合计** | | **206/206** |

最终汇总保留第一次完整回归中其他 9 个脚本的通过日志，并合并媒体脚本的修正后复验。媒体测试最初把“已授权”场景也放在禁止媒体的页面上，导致无法获得原生 label；改为独立的允许页面后 5 项全部通过。较早诊断记录保留在本地 `test-results/`，没有将失败结果改写为成功。

## 本次修复

1. **几何精度**：在 DOMRect double 字段加扰动，解决约 1000px 坐标经 float 转换后扰动归零。仅 JS 返回路径处理，保留布局、构造器、零尺寸、隐藏、脱离文档、空 Range 和空文本语义。
2. **跨 API 基线**：旋转元素的 Element/Range 原生路径存在约 `3.05e-5` 差异。测试约束各自相对原生偏移不超过 `1e-5`；原生相等字段仍严格相等，原生不等字段的差值变化不超过 `2e-5`。
3. **字体过滤**：按 SkTypeface 解析后的真实 family 和本地化 family 校验，覆盖 `local()`、PostScript 名称；补充 NSimSun/Arial Black 标准字体。避免把 CSS 字体别名误当作未安装字体。
4. **字体测试**：为缺失字体指定明确的 Courier New 回退。宿主默认回退可与 Arial 相同，原先仅以二者宽度不同判断字体功能不可靠。新增真实已安装、但模板排除的 Cascadia Code 作为过滤对照。
5. **媒体与语音**：未授权模板尊重启用的 Permissions Policy；授权后已有 label 的列表保留原生。语音 URI 与 Chromium 原生一致，使用语音名称。
6. **Demo**：修复 CSP 阻止侧栏、UA 重复版本段和迁移、启动依赖、代理与 IPC 时序、窗口关闭后的 webContents 释放。详见 [Demo 验收说明](../../fp-demo/ACCEPTANCE.md)。

## 补丁与复现

12 个 Chromium 补丁在独立临时目录中顺序执行 `git apply --check` 和 `git apply`，涉及 **41 个文件全部逐字节一致**，没有改变真实源码树或其索引。重放基线是 Chromium 树 `4046047818ce96c6a15ef43d6b52fe18442374fc`。

在 `D:\project\webtt\fp-kernel` 执行：

```powershell
python scripts/run-acceptance.py
python scripts/verify-patches.py --output test-results/patch-replay.json
```

在 `D:\project\webtt\fp-demo` 执行：

```powershell
node tests/run-acceptance.js
npm start
```

## 验收边界

- 本地断言通过不代表第三方检测无法识别，公开站点结果见独立报告。
- 模板未授权设备为项目约定的固定集合；没有验证模板 ID 的真实采集/输出映射、逐个 TTS 声音合成。
- SpeakerSelection 在此 Electron 默认未启用；媒体政策测试显式开启该 Blink 特性来验证扬声器政策分支。默认内核的麦克风/摄像头策略及模板行为另由综合测试覆盖。
- 字体模板依赖宿主已安装字体；Cascadia Code 对照是本机测试前提，换机器应选择已安装且不在模板内的字体。
- 既有 8 项噪声验收覆盖稳定性和账号差异，没有证明所有 Canvas 编解码路径逐像素等价。
- 未测试真实代理及认证、外部账号登录、翻译服务、同版本真 Chrome 152 全项对照或完整发行安装包。
