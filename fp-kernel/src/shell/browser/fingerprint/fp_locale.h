// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef SHELL_BROWSER_FINGERPRINT_FP_LOCALE_H_
#define SHELL_BROWSER_FINGERPRINT_FP_LOCALE_H_

namespace base {
class CommandLine;
}

namespace fp {

// 从命令行的 --fp-config（base64 JSON）读取 navigator.languages[0]，
// 用 BCP47 语义（forLanguageTag）设为 ICU 默认区域。无配置时不动。
// 用于纠正 LoadLocaleResources 把 ja-JP 归一化为 ja 的副作用；
// 必须在 V8 固化 default locale 之前调用。
void RestoreIcuLocaleFromConfig(const base::CommandLine& command_line);

}  // namespace fp

#endif  // SHELL_BROWSER_FINGERPRINT_FP_LOCALE_H_
