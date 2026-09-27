// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_CONFIG_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_CONFIG_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/values.h"
#include "third_party/blink/renderer/platform/platform_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace base {
template <typename T>
class NoDestructor;
}  // namespace base

namespace fp {

// Hook keys for the one-line `// FP-HOOK` call sites inserted into upstream
// files. Each key maps to a dotted path in the fp-config JSON plus the
// feature name consulted against the config's "disable" list.
enum class HookKey {
  kUserAgent,
  kNavigatorPlatform,
  kHardwareConcurrency,
  kDeviceMemory,
  kTimezone,
  kScreenWidth,
  kScreenHeight,
  kScreenAvailWidth,
  kScreenAvailHeight,
  kScreenColorDepth,
  kDevicePixelRatio,
  kWebGLVendor,
  kWebGLRenderer,
};

// Process-wide singleton holding the per-account fingerprint config.
//
// The config arrives on the command line as `--fp-config=<base64(json)>`
// (appended per-session by the Electron browser process). It is parsed once,
// lazily, on first access, and is immutable afterwards, so it is safe to call
// from any thread, including dedicated/shared/service workers. Without a
// valid config every query reports "absent" and all hooks return their
// original values, i.e. the kernel behaves exactly like stock Electron.
class PLATFORM_EXPORT FingerprintConfig {
 public:
  static FingerprintConfig& Get();

  // True when a syntactically valid config was supplied.
  bool Enabled() const { return enabled_; }

  // True when |feature| (e.g. "canvas", "fonts") appears in the config's
  // "disable" list. Disabled features must fall back to original values.
  bool IsDisabled(std::string_view feature) const;

  // Opaque account seed. Only meaningful when Enabled().
  const std::string& Seed() const { return seed_; }

  // Dotted-path accessors, e.g. GetInt("navigator.hardwareConcurrency").
  // Absent keys or type mismatches return std::nullopt.
  std::optional<std::string> GetString(std::string_view dotted_path) const;
  std::optional<int64_t> GetInt(std::string_view dotted_path) const;
  std::optional<double> GetDouble(std::string_view dotted_path) const;
  std::optional<bool> GetBool(std::string_view dotted_path) const;
  std::optional<std::vector<std::string>> GetStringList(
      std::string_view dotted_path) const;

  // Deterministic noise derived from the account seed and a purpose tag
  // (e.g. "canvas"). Same account + same purpose always yields the same
  // value, across restarts and across renderer processes of that account.
  // With no config enabled the result is still deterministic but callers
  // must not apply noise unless Enabled().
  uint64_t NoiseUInt64(std::string_view purpose) const;
  // [0, 1) variant of NoiseUInt64.
  double NoiseUnit(std::string_view purpose) const;
  // Integer in [min, max].
  int64_t NoiseInt(std::string_view purpose, int64_t min, int64_t max) const;

 private:
  FingerprintConfig();
  ~FingerprintConfig() = default;

  friend class base::NoDestructor<FingerprintConfig>;

  bool enabled_ = false;
  std::string seed_;
  base::DictValue dict_;
};

// One-line hooks for upstream call sites. Each returns the configured
// override when the config is enabled, the key exists, and the feature is
// not disabled; otherwise returns |original| unchanged.
PLATFORM_EXPORT int64_t Hook(HookKey key, int64_t original);
PLATFORM_EXPORT unsigned Hook(HookKey key, unsigned original);
PLATFORM_EXPORT double Hook(HookKey key, double original);
PLATFORM_EXPORT blink::String Hook(HookKey key, const blink::String& original);

// WebGPU adapter info 与 webgl 配置段自洽：vendor 从显卡品牌推导
// （nvidia/intel/amd），description 取 ANGLE 串中的卡名。无配置不动。
PLATFORM_EXPORT void HookWebGPUAdapter(blink::String& vendor,
                                       blink::String& description);

}  // namespace fp

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_FINGERPRINT_FINGERPRINT_CONFIG_H_
