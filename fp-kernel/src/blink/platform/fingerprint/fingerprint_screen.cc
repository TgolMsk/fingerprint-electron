// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_screen.h"

#include "base/no_destructor.h"
#include "third_party/blink/renderer/platform/fingerprint/fingerprint_config.h"
#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"

namespace fp {

namespace {

bool ApplyScreenOverride(const display::ScreenInfo& in,
                         display::ScreenInfo* out) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("screen"))
    return false;
  *out = in;
  bool touched = false;
  if (std::optional<int64_t> width = cfg.GetInt("screen.width")) {
    out->rect.set_width(static_cast<int>(*width));
    touched = true;
  }
  if (std::optional<int64_t> height = cfg.GetInt("screen.height")) {
    out->rect.set_height(static_cast<int>(*height));
    touched = true;
  }
  if (std::optional<int64_t> avail_width = cfg.GetInt("screen.availWidth")) {
    out->available_rect.set_width(static_cast<int>(*avail_width));
    touched = true;
  } else if (touched) {
    out->available_rect.set_width(out->rect.width());
  }
  if (std::optional<int64_t> avail_height = cfg.GetInt("screen.availHeight")) {
    out->available_rect.set_height(static_cast<int>(*avail_height));
    touched = true;
  }
  if (std::optional<int64_t> color_depth = cfg.GetInt("screen.colorDepth")) {
    out->depth = static_cast<int>(*color_depth);
    out->depth_per_component = *color_depth >= 30 ? 10 : 8;
    touched = true;
  }
  if (std::optional<double> dpr = cfg.GetDouble("screen.dpr")) {
    out->device_scale_factor = static_cast<float>(*dpr);
    touched = true;
  }
  return touched;
}

}  // namespace

const display::ScreenInfo& HookScreenInfo(const display::ScreenInfo& original) {
  // 仅主线程使用（DOM/CSS 媒体查询路径）。
  static base::NoDestructor<display::ScreenInfo> overridden;
  if (ApplyScreenOverride(original, overridden.get()))
    return *overridden;
  return original;
}

const display::ScreenInfos& HookScreenInfos(
    const display::ScreenInfos& original) {
  static base::NoDestructor<display::ScreenInfos> overridden;
  bool any = false;
  *overridden = original;
  for (auto& info : overridden->screen_infos) {
    display::ScreenInfo one;
    if (ApplyScreenOverride(info, &one)) {
      info = one;
      any = true;
    }
  }
  if (any)
    return *overridden;
  return original;
}

}  // namespace fp
