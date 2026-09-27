// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_FONTS_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_FONTS_H_

#include "third_party/blink/renderer/platform/platform_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace fp {

// 字体过滤是否启用（fp-config 存在、未禁用、fonts 模板已知）。
PLATFORM_EXPORT bool FontsFilterEnabled();

// 该字体家族名是否在内置白名单内（不区分大小写）。
// 模板 "win-default" = Windows 11 默认字体集。仅在 FontsFilterEnabled()
// 为真时有意义；白名单外的字体应按"未安装"处理。
PLATFORM_EXPORT bool FontAllowed(const blink::String& family);

}  // namespace fp

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_FONTS_H_
