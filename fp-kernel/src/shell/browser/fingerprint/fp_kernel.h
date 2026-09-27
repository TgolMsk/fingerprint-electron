// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef SHELL_BROWSER_FINGERPRINT_FP_KERNEL_H_
#define SHELL_BROWSER_FINGERPRINT_FP_KERNEL_H_

namespace fp {

// Self-reported kernel version, exposed to the app as
// process.versions.fpkernel. The app refuses to log in accounts when this
// is absent or outside its compatible range. Bump on every kernel change.
inline constexpr char kVersion[] = "0.1.0";

// Command line switch carrying the per-session fingerprint config
// (base64-encoded JSON) to renderer processes. The Blink-side reader in
// third_party/blink/renderer/platform/fingerprint/ uses the same name.
inline constexpr char kConfigSwitch[] = "fp-config";

}  // namespace fp

#endif  // SHELL_BROWSER_FINGERPRINT_FP_KERNEL_H_
