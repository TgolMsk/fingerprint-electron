# fp_00_config — 阶段 2 钩子规范（Chromium/Blink 侧）

对应补丁：`patches/chromium/fp_00_config.patch`（打入 `D:\e\src`，
追加到 Electron `patches/chromium/.patches` 末尾）。

新文件原样加入，源头在 fp-kernel：
- `src/blink/platform/fingerprint/fingerprint_config.h`
- `src/blink/platform/fingerprint/fingerprint_config.cc`
→ 目标位置：`third_party/blink/renderer/platform/fingerprint/`

## 1. `third_party/blink/renderer/platform/BUILD.gn`

在主 sources 列表中按字母序插入（`fonts/` 条目之后）：

```
    "fingerprint/fingerprint_config.cc",  # FP-HOOK
    "fingerprint/fingerprint_config.h",  # FP-HOOK
```

## 2. `third_party/blink/renderer/platform/DEPS`

include_rules 中追加（`base/base64.h` 不在现有白名单）：

```
    "+base/base64.h",  # FP-HOOK
```

（`+base/command_line.h`、`+base/json`、`+base/no_destructor.h` 已在白名单。）

## 3. 临时调试钩子（阶段 2 验收用，阶段 3 正式化）

`third_party/blink/renderer/core/frame/navigator_concurrent_hardware.cc`：

```cpp
unsigned NavigatorConcurrentHardware::hardwareConcurrency() const {
  unsigned value = static_cast<unsigned>(base::SysInfo::NumberOfProcessors());
  return fp::Hook(fp::HookKey::kHardwareConcurrency, value);  // FP-HOOK
}
```

加 `#include "third_party/blink/renderer/platform/fingerprint/fingerprint_config.h"`。

## 验收

两个账号分别配 `hardwareConcurrency: 4` 和 `12`，在各自页面、嵌套跨站
iframe、Web Worker 里读到的值都正确；没有 `--fp-config` 的页面返回宿主机
真实核数，与原版完全一致。
