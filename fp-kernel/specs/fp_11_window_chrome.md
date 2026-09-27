# fp_11_window_chrome（P0）— 设计稿（基于 M152 探查）

目标：页面主世界出现与真 Chrome 152 逐项一致的 `window.chrome`
（loadTimes / csi / app），全部 v8 原生函数，toString 为 native 形态。
这是"破绽修复"——不依赖 fp-config，所有页面都装上（真 Chrome 对所有网页都装）。

## 探查结论

- M152 已重构：`chrome/renderer/loadtimes_bindings.{h,cc}`（gin::Wrappable），
  旧 `loadtimes_extension_bindings.cc` 不存在。
- 真 Chrome 注册点：`chrome/renderer/chrome_render_frame_observer.cc:394-398`
  `DidCreateScriptContext` → `LoadTimesBindings::Install(context)`（所有 world）。
- `window.chrome` 本体：`content/public/renderer/chrome_object_extensions_utils.cc`
  `content::GetOrCreateChromeObject()` 惰性创建（`global.chrome ??= {}`，普通 Set，
  可枚举/可写/可配置）。
- `chrome.app` 走 extensions API 系统（`app_hooks_delegate.cc`），真 Chrome 网页里键：
  `isInstalled`(原生访问器,false)、`getIsInstalled()`(false)、`installState(cb)`(回调 "not_installed")、
  `getDetails()`(null)、`runningState()`("cannot_run")、
  `InstallState={NOT_INSTALLED,INSTALLED,DISABLED}`、`RunningState={RUNNING,CANNOT_RUN,READY_TO_RUN}`。
- `loadTimes()` 13 键（M152 实测）：requestTime, startLoadTime, commitLoadTime,
  finishDocumentLoadTime, finishLoadTime, firstPaintTime, firstPaintAfterLoadTime(恒0),
  navigationType, wasFetchedViaSpdy, wasNpnNegotiated, npnNegotiatedProtocol,
  wasAlternateProtocolAvailable, connectionInfo。数据来自
  `frame->PerformanceMetricsForReporting()` + `document_loader->GetWebResponse()`。
- `csi()` 4 键：startE, onloadT(=DCL), pageT, tran(Link=0/BackForward=6/Reload=16/Other=15)。
- **函数名问题**：M152 用 `v8::Function::New` 且未 SetName → 真 Chrome 152 的
  `chrome.loadTimes.toString()` 很可能是 `function () { [native code] }`（空名）。
  实现时照抄官方代码、不加 SetName；阶段 5 用真 Chrome 152 逐项对比后再定。
- Electron 注入点：`electron/shell/renderer/electron_render_frame_observer.cc`
  `DidInstallConditionalFeatures`（:121 附近），`is_main_world(world_id)` 守卫（:46 已有）。
  注意 `RendererClientBase::DidCreateScriptContext` 只在隔离世界触发，不能挂那里。

## 实现（Electron 侧补丁 fp_11_window_chrome.patch）

新文件 `shell/renderer/chrome_object_bindings.{h,cc}`：
- 几乎照抄 `chrome/renderer/loadtimes_bindings.cc` 的 GetLoadTimes/GetCSI，
  简化为无状态静态回调（不用 gin::Wrappable/cppgc）。
- `InstallChromeObjectBindings(v8::Local<v8::Context> context)`：
  MicrotasksScope(kDoNotRunMicrotasks) + Context::Scope → GetOrCreateChromeObject →
  v8::Function::New 建 loadTimes/csi → 建 chrome.app（4 原生函数 + isInstalled 用
  SetNativeDataProperty 访问器 + InstallState/RunningState 两个普通对象）。
- 加入 `filenames.gni` renderer 源列表。

钩子（1-2 行）：`electron_render_frame_observer.cc` `DidInstallConditionalFeatures` 内
```cpp
if (electron::is_main_world(world_id))
  electron::InstallChromeObjectBindings(context);  // FP-HOOK
```

## 验收

与真 Chrome 152 逐项对比：`Object.keys(window.chrome)`、loadTimes() 键集、csi() 键集、
app 键集与枚举值、各函数 toString 形态、属性描述符（enumerable/writable/configurable）。
