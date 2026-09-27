// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_NOISE_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_NOISE_H_

#include <cstddef>
#include <cstdint>

#include "base/containers/span.h"
#include "third_party/blink/renderer/platform/platform_export.h"

namespace fp {

// Canvas 噪声是否启用（fp-config 存在、未禁用、noise.canvas=true）。
PLATFORM_EXPORT bool CanvasNoiseEnabled();

// Canvas 读回路径确定性噪声：按 seed + 像素坐标决定，约 1% 像素的
// R 通道最低位取反。位置相关而非内容相关，保证同一画面经
// getImageData / toDataURL / readPixels 读出时结果一致。
// |buffer| 为整块像素内存（RGBA8888），|row_bytes| 允许行对齐填充；
// |origin_x/origin_y| 为读回区域在源画布中的偏移（噪声按画布坐标计算）。
// 无 fp-config 或 noise.canvas=false 时不动。
PLATFORM_EXPORT void AddCanvasNoise(base::span<uint8_t> buffer,
                                    int width,
                                    int height,
                                    size_t row_bytes,
                                    int origin_x = 0,
                                    int origin_y = 0);

// Audio 确定性扰动：±1e-7 级，按 seed + 用途 + 采样索引派生。
// 用于 AudioBuffer 一次性自噪（fp_noised 守卫）与 AnalyserNode 输出。
PLATFORM_EXPORT void AddAudioNoise(base::span<float> data, const char* purpose);

// ClientRects/measureText 亚像素抖动：±1e-5 级，按 seed+tag+原值派生，
// 同一原值抖动恒定。保留零值；结果必须保持 double，不能写回布局用的 RectF。
// noise.rects=false 时原样返回。
PLATFORM_EXPORT double JitterRect(const char* tag, double original);

}  // namespace fp

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_NOISE_H_
