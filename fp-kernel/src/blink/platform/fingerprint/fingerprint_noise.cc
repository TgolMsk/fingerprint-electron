// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_noise.h"

#include <cmath>
#include <string>

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_config.h"

namespace fp {

bool CanvasNoiseEnabled() {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("canvas"))
    return false;
  std::optional<bool> enabled = cfg.GetBool("noise.canvas");
  return enabled.has_value() && *enabled;
}

void AddCanvasNoise(base::span<uint8_t> buffer,
                    int width,
                    int height,
                    size_t row_bytes,
                    int origin_x,
                    int origin_y) {
  if (!CanvasNoiseEnabled())
    return;
  if (width <= 0 || height <= 0 ||
      row_bytes < static_cast<size_t>(width) * 4 ||
      buffer.size() < row_bytes * static_cast<size_t>(height))
    return;

  const FingerprintConfig& cfg = FingerprintConfig::Get();

  uint32_t flips = 0;
  (void)flips;
  for (int y = 0; y < height; ++y) {
    base::span<uint8_t> row =
        buffer.subspan(static_cast<size_t>(y) * row_bytes,
                       static_cast<size_t>(width) * 4);
    for (int x = 0; x < width; ++x) {
      // 与 seed、画布坐标绑定：同一账号同一位置结果恒定
      uint64_t h = cfg.NoiseUInt64("canvas:" + std::to_string(origin_x + x) +
                                   ":" + std::to_string(origin_y + y));
      if (h % 97 == 0) {
        row[static_cast<size_t>(x) * 4] ^= 1;  // R 通道最低位
        ++flips;
      }
    }
  }
}

void AddAudioNoise(base::span<float> data, const char* purpose) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("audio"))
    return;
  std::optional<bool> enabled = cfg.GetBool("noise.audio");
  if (!enabled.has_value() || !*enabled)
    return;
  for (size_t i = 0; i < data.size(); ++i) {
    int64_t delta =
        cfg.NoiseInt(std::string(purpose) + ":" + std::to_string(i), -1, 1);
    data[i] += static_cast<float>(delta) * 1e-7f;
  }
}

double JitterRect(const char* tag, double original) {
  // Zero geometry and empty-text metrics must stay exactly zero.
  if (original == 0 || !std::isfinite(original))
    return original;
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("rects"))
    return original;
  std::optional<bool> enabled = cfg.GetBool("noise.rects");
  if (!enabled.has_value() || !*enabled)
    return original;
  // 原值参与派生：不同 rect 抖动不同，同一 rect 多次测量抖动恒定
  uint64_t h = cfg.NoiseUInt64(std::string("rects:") + tag + ":" +
                               std::to_string(original));
  double unit = static_cast<double>(h >> 11) / 9007199254740992.0;
  return original + (unit - 0.5) * 2e-5;
}

}  // namespace fp
