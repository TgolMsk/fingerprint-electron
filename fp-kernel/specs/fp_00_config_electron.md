# fp_00_config — 阶段 2 钩子规范（Electron 侧）

对应补丁：`patches/electron/fp_00_config.patch`（打入 `D:\e\src\electron`，基于 v44.4.5 / fp-main）。

本文件记录每一处插入的精确位置与内容。所有插入行尾标记 `// FP-HOOK`。
新文件 `shell/browser/fingerprint/fp_kernel.h` 原样加入，源头在
`fp-kernel/src/shell/browser/fingerprint/fp_kernel.h`。

## 1. `shell/browser/electron_browser_context.h`

在 `std::string GetUserAgent() const;`（约 93 行）后插入：

```cpp
  void SetFingerprintConfig(std::string config_base64);          // FP-HOOK
  const std::string& fingerprint_config() const {                // FP-HOOK
    return fingerprint_config_;                                  // FP-HOOK
  }                                                              // FP-HOOK
```

在 `std::optional<std::string> user_agent_;`（约 224 行）后插入成员：

```cpp
  std::string fingerprint_config_;  // FP-HOOK
```

## 2. `shell/browser/electron_browser_context.cc`

实现 setter（文件尾部或 SetUserAgent 实现旁，约 526 行后）：

```cpp
void ElectronBrowserContext::SetFingerprintConfig(  // FP-HOOK
    std::string config_base64) {                    // FP-HOOK
  fingerprint_config_ = std::move(config_base64);   // FP-HOOK
}                                                   // FP-HOOK
```

## 3. `shell/browser/api/electron_api_session.cc`

新增方法（放在 `Session::SetUserAgent` 实现之后，约 1035 行）：

```cpp
// FP-HOOK begin
void Session::SetFingerprintConfig(const std::string& config_json) {
  // 接收原始 JSON，base64 后存入 BrowserContext；
  // AppendExtraCommandLineSwitches 负责下发到该分区全部渲染进程。
  browser_context_->SetFingerprintConfig(base::Base64Encode(config_json));
}
// FP-HOOK end
```

需要 `#include "base/base64.h"`（若无）。头文件 `electron_api_session.h`
在 `SetUserAgent` 声明旁加：

```cpp
  void SetFingerprintConfig(const std::string& config_json);  // FP-HOOK
```

模板注册（`setUserAgent` 注册行旁，约 1826 行）：

```cpp
      .SetMethod("setFingerprintConfig", &Session::SetFingerprintConfig)  // FP-HOOK
```

## 4. `shell/browser/electron_browser_client.cc`

`AppendExtraCommandLineSwitches` 的 `kRendererProcess` 分支内
（`web_preferences` 处理块之后、函数结束前，约 692 行后）：

```cpp
    // FP-HOOK begin：按 Session 下发指纹配置，覆盖跨站 iframe / Worker
    if (render_process_host && !render_process_host->IsSpare()) {
      auto* ctx = static_cast<ElectronBrowserContext*>(
          render_process_host->GetBrowserContext());
      if (ctx && !ctx->fingerprint_config().empty()) {
        command_line->AppendSwitchASCII(fp::kConfigSwitch,
                                        ctx->fingerprint_config());
      }
    }
    // FP-HOOK end
```

需要 `#include "shell/browser/fingerprint/fp_kernel.h"`。
`ElectronBrowserContext` 在该文件已可用（文件内已有多处 static_cast 用法）。

## 5. `shell/common/node_bindings.cc`

`versions.SetReadOnly("chrome", CHROME_VERSION_STRING);`（约 1238 行）后：

```cpp
    versions.SetReadOnly("fpkernel", fp::kVersion);  // FP-HOOK
```

并 `#include "shell/browser/fingerprint/fp_kernel.h"`。

## 6. `shell/browser/BUILD.gn`

sources 列表追加：

```
    "browser/fingerprint/fp_kernel.h",  # FP-HOOK
```

## 验收

`ses.setFingerprintConfig(JSON.stringify(cfg))` 后，该分区所有渲染进程
（页面、跨站 iframe、Dedicated/Service Worker）命令行均带 `--fp-config`；
`process.versions.fpkernel === "0.1.0"`；不调用 API 时无任何行为变化。
