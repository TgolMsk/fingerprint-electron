// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_SCREEN_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_SCREEN_H_

#include "third_party/blink/renderer/platform/platform_export.h"

namespace display {
struct ScreenInfo;
struct ScreenInfos;
}  // namespace display

namespace fp {

// 按 fp-config 的 screen 段覆盖屏幕信息；无配置或未禁用项缺失时
// 原样返回 |original|（零拷贝）。覆盖时返回线程本地修改副本。
// 仅主线程使用（screen.* 与 CSS 媒体查询都在主线程）。
PLATFORM_EXPORT const display::ScreenInfo& HookScreenInfo(
    const display::ScreenInfo& original);
PLATFORM_EXPORT const display::ScreenInfos& HookScreenInfos(
    const display::ScreenInfos& original);

}  // namespace fp

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_SCREEN_H_
