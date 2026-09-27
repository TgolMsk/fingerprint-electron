# fp_10_ua_client_hints（P0）— 设计稿（基于 M152 探查）

目标：UA、`userAgentData`、`Sec-CH-UA-*` 三处一致且与同版本真 Chrome 相同；
去掉一切 `Electron/` 痕迹。配置生效时按 `fp-config` 覆盖，无配置时行为=官方。

## 探查结论（v44.4.5 / Chromium 152 实测定位）

- 渲染进程 UA：browser 经 `InitializeRenderer` mojo 下发（`render_process_host_impl.cc:2015`），
  renderer 缓存在 `RenderThreadImpl::user_agent_`（`render_thread_impl.cc:1162`）。
  Dedicated Worker 继承父上下文；Service Worker 走 `service_worker_version.cc:2688` 单独下发。
- 默认 brands：`components/embedder_support/user_agent_utils.cc:491-512`
  `GenerateBrandVersionList()` = GREASE + `{"Chromium", ver}`（Electron 是 Chromium branding，
  **缺 "Google Chrome"**，与真 Chrome 差一条）。
- **Electron 导航请求不发 Sec-CH-UA-* 头**：`ElectronBrowserContext::GetClientHintsControllerDelegate()`
  返回 nullptr（`electron_browser_context.cc:686`），`navigation_request.cc:2074` 判空跳过。
  真 Chrome 导航带 `Sec-CH-UA`、`Sec-CH-UA-Mobile`、`Sec-CH-UA-Platform`，这是明显破绽。
- 子资源请求的 CH 头在 renderer 内 `frame_fetch_context.cc:641 AddClientHintsIfNecessary()` 生成，
  数据同源 userAgentData。
- `webContents.setUserAgent`（`electron_api_web_contents.cc:3398`）覆盖时把 metadata 设为
  `embedder_support::GetUserAgentMetadata()`（即默认 Chromium brands）——session.setUserAgent 后
  brands 不跟随，必须一起改。
- `Electron/` 后缀：`shell/common/application_info.cc:36-51 GetApplicationUserAgent()`。

## Chromium 侧补丁（fp_10_ua_client_hints.patch）

1. `components/embedder_support/user_agent_utils.cc` `GenerateBrandVersionList()`：
   在 Chromium branding 路径也追加 `{"Google Chrome", major_version}`（真 Chrome 同款三品牌），
   仅 1-3 行。无 fp-config 时也需要——这是"去 Electron 化"，不是按账号伪装。
   （注意：该改动让官方行为也变成 Chrome brands，属"破绽修复"，登记在表。）
2. `content/browser/renderer_host/render_process_host_impl.cc:2015` 附近：
   UA 下发处按 BrowserContext 的 fp-config（若有）替换 UA 字符串为 `ua.string`。// FP-HOOK
3. `content/browser/service_worker/service_worker_version.cc:2688`：同上，按该
   SW 所属 BrowserContext 的 fp-config 替换。// FP-HOOK
4. 导航 CH 头：实现最小 `ClientHintsControllerDelegate`（或直接在
   `navigation_request.cc:2074` 判空分支补写 UA 三头）。优先方案：给
   `ElectronBrowserContext` 返回一个非空 delegate（仿 `chrome/browser/client_hints/` 最小实现），
   使真路径生效；fp-config 存在时 UA metadata 经第 5 条覆盖。
5. `content/renderer/render_thread_impl.cc`：InitializeRenderer 后存
   `user_agent_metadata_` 处，若 fp-config 有 `ua` 段则改写 metadata
   （brand/fullVersionList/platform/platformVersion/arch/bitness/model/mobile）。// FP-HOOK
   ——覆盖 userAgentData 与子资源 Sec-CH-UA-*。
6. （备选，更上游）在 `LocalFrameClientImpl::UserAgentMetadata()`（`local_frame_client_impl.cc:962`）
   做 blink 侧兜底改写。

## Electron 侧补丁（fp_10_ua.patch，随 fp_00 之后 git am）

7. `shell/common/application_info.cc:43-48`：删除 `Electron/<ver>` 后缀与 app 名前缀，
   仅保留 `Chrome/<ver>`（与真 Chrome UA 相同；无 fp-config 时也是如此）。// FP-HOOK
8. `shell/browser/api/electron_api_web_contents.cc:3402`：metadata override 改为
   "fp-config 有 ua 段 → 用配置构造 metadata；否则保持默认"。// FP-HOOK
9. `shell/browser/electron_browser_client.cc:1262/1272` `GetUserAgent()/GetUserAgentMetadata()`：
   默认值去 Electron 化（随第 7 条自然生效，确认无遗漏）。

## 验收

- fp检测页/CreepJS：UA 无 Electron、brands = 真 Chrome 三件套、fullVersionList 版本=内核真实版本。
- 抓包：导航请求含 Sec-CH-UA 三头；子资源头一致；Service Worker 内 UA 一致。
- 两个账号不同 `ua.string` 时各自生效；无配置页面 = 官方行为（除 brands 补 Google Chrome）。
