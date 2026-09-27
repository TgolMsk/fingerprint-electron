// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "shell/browser/fingerprint/fp_ua.h"

#include "base/values.h"
#include "components/embedder_support/user_agent_utils.h"
#include "shell/browser/electron_browser_context.h"

namespace fp {

namespace {

void ApplyString(const base::DictValue& dict,
                 std::string_view key,
                 std::string* out) {
  const std::string* value = dict.FindString(key);
  if (value && !value->empty())
    *out = *value;
}

}  // namespace

const base::DictValue* ConfigDict(
    electron::ElectronBrowserContext* browser_context) {
  if (!browser_context)
    return nullptr;
  return browser_context->fingerprint_config_dict();
}

blink::UserAgentMetadata BuildUserAgentMetadata(
    electron::ElectronBrowserContext* browser_context) {
  blink::UserAgentMetadata metadata = embedder_support::GetUserAgentMetadata();
  const base::DictValue* config = ConfigDict(browser_context);
  if (!config)
    return metadata;
  const base::DictValue* ua = config->FindDict("ua");
  if (!ua)
    return metadata;
  // 品牌列表沿用内核默认值（已与真 Chrome 一致）；UA 版本按规则必须等于
  // 内核真实版本，fullVersion 覆盖仅作防御性同步。
  ApplyString(*ua, "platform", &metadata.platform);
  ApplyString(*ua, "platformVersion", &metadata.platform_version);
  ApplyString(*ua, "arch", &metadata.architecture);
  ApplyString(*ua, "bitness", &metadata.bitness);
  ApplyString(*ua, "fullVersion", &metadata.full_version);
  ApplyString(*ua, "model", &metadata.model);
  return metadata;
}

std::string ResolveUserAgent(
    electron::ElectronBrowserContext* browser_context) {
  const base::DictValue* config = ConfigDict(browser_context);
  if (config) {
    const std::string* ua = config->FindStringByDottedPath("ua.string");
    if (ua && !ua->empty())
      return *ua;
  }
  if (browser_context)
    return browser_context->GetUserAgent();
  return embedder_support::GetUserAgent();
}

}  // namespace fp
