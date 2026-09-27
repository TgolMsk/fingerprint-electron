// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "shell/browser/fingerprint/fp_client_hints_delegate.h"

#include "shell/browser/fingerprint/fp_ua.h"
#include "third_party/blink/public/common/client_hints/enabled_client_hints.h"

namespace fp {

FpClientHintsDelegate::FpClientHintsDelegate(
    electron::ElectronBrowserContext* browser_context)
    : browser_context_(browser_context) {}

FpClientHintsDelegate::~FpClientHintsDelegate() = default;

network::NetworkQualityTracker* FpClientHintsDelegate::GetNetworkQualityTracker() {
  // 返回 nullptr 时网络质量类提示头使用默认值兜底（见 client_hints.cc 的
  // AddRttHeader 等），安全且与常规值域一致。
  return nullptr;
}

void FpClientHintsDelegate::GetAllowedClientHintsFromSource(
    const url::Origin& origin,
    blink::EnabledClientHints* client_hints) {
  auto it = persisted_hints_.find(origin);
  if (it != persisted_hints_.end()) {
    for (const auto type : it->second)
      client_hints->SetIsEnabled(type, true);
  }
  for (const auto type : additional_hints_)
    client_hints->SetIsEnabled(type, true);
}

bool FpClientHintsDelegate::IsJavaScriptAllowed(
    const GURL& url,
    content::RenderFrameHost* parent_rfh) {
  return true;
}

blink::UserAgentMetadata FpClientHintsDelegate::GetUserAgentMetadata() {
  return BuildUserAgentMetadata(browser_context_);
}

void FpClientHintsDelegate::PersistClientHints(
    const url::Origin& primary_origin,
    content::RenderFrameHost* parent_rfh,
    const std::vector<network::mojom::WebClientHintsType>& client_hints) {
  persisted_hints_[primary_origin] = client_hints;
}

void FpClientHintsDelegate::SetAdditionalClientHints(
    const std::vector<network::mojom::WebClientHintsType>& hints) {
  additional_hints_ = hints;
}

void FpClientHintsDelegate::ClearAdditionalClientHints() {
  additional_hints_.clear();
}

void FpClientHintsDelegate::SetMostRecentMainFrameViewportSize(
    const gfx::Size& viewport_size) {
  viewport_size_ = viewport_size;
}

gfx::Size FpClientHintsDelegate::GetMostRecentMainFrameViewportSize() {
  return viewport_size_;
}

}  // namespace fp
