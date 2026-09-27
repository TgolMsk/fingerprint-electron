# fp_13_webdriver + fp_14_timezone_lang（P0）— 设计稿

## fp_13_webdriver（Chromium 补丁）

探查结论：`navigator.webdriver` 唯一 getter 在
`third_party/blink/renderer/core/frame/navigator.cc:100`，由
RuntimeEnabledFeature `AutomationControlled` 决定；`--enable-automation`、
`--headless`、`--remote-debugging-pipe`、`--remote-debugging-port` 会打开它
（`content/child/runtime_features.cc:395-397,446-453`）。WorkerNavigator 无此属性（预期）。

改法（1 行，FP-HOOK）：
```cpp
bool Navigator::webdriver() const {
  return false;  // FP-HOOK：内核永不暴露自动化标记
  ...
}
```
应用侧配合（无需补丁）：`contextIsolation:true`、`nodeIntegration:false`、
`sandbox:true`；生产不开远程调试端口；页面主世界不得出现 process/require/Buffer。

验收：bot.sannysoft.com 全绿；`navigator.webdriver === false`。

## fp_14_timezone_lang（Chromium + Electron 补丁）

探查结论：
- `TimeZoneController::SetTimeZoneOverride(String)`（`core/timezone/timezone_controller.cc:147-175`）
  校验 IANA id → `icu::TimeZone::adoptDefault` + 通知所有 isolate/worker；返回 RAII 句柄，
  **析构即失效**，必须 leaked 持有。已有 override 时返回 kAlreadyInEffect（会挡 DevTools 模拟）。
- 触发点（Electron 侧）：`shell/renderer/renderer_client_base.cc:231`
  `RendererClientBase::RenderThreadStarted()`——读 fp-config 的 `timezone`，调用
  `blink::TimeZoneController::SetTimeZoneOverride` 并把句柄 `std::unique_ptr` 存进 leaked static。
- `--lang`：browser 拼 `--lang` 经 `render_process_host_impl.cc:5171-5176` 下发，
  renderer `GetLocale()`（`render_thread_impl.cc:716-717`）喂 blink `DefaultLanguage()`。
  Electron 侧在 `AppendExtraCommandLineSwitches`（fp_00 的 FP-HOOK 同函数）按 fp-config 的
  `navigator.languages[0]` 追加 `--lang=<lang>`。ICU default locale（影响
  `Intl.DateTimeFormat().resolvedOptions().locale`）在 RenderThreadStarted 里一并
  `icu::Locale::setDefault`。
- `Accept-Language` 头：应用侧 `session.setUserAgent(ua, acceptLanguages)` 已覆盖（demo 已做）。

验收：自建一致性页四处 timezone 相同；BrowserScan 时区与代理 IP 地区匹配；
`Intl` locale 与 `navigator.language` 一致。
