// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef SHELL_BROWSER_FINGERPRINT_FP_UA_H_
#define SHELL_BROWSER_FINGERPRINT_FP_UA_H_

#include <string>

#include "third_party/blink/public/common/user_agent/user_agent_metadata.h"

namespace base {
class DictValue;
}

namespace electron {
class ElectronBrowserContext;
}  // namespace electron

namespace fp {

// 该分区的 fp-config JSON（无配置或解析失败返回 nullptr），惰性解析并缓存。
const base::DictValue* ConfigDict(
    electron::ElectronBrowserContext* browser_context);

// 以 embedder_support 默认值（品牌列表已与真 Chrome 一致）为底，
// 用配置 ua 段覆盖 platform / platformVersion / arch / bitness / fullVersion。
// 无配置时返回值与同版本真 Chrome 相同。
blink::UserAgentMetadata BuildUserAgentMetadata(
    electron::ElectronBrowserContext* browser_context);

// 该分区应使用的 UA 字符串：配置 ua.string > 分区 session UA > 全局默认。
std::string ResolveUserAgent(
    electron::ElectronBrowserContext* browser_context);

}  // namespace fp

#endif  // SHELL_BROWSER_FINGERPRINT_FP_UA_H_
