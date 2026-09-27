// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef SHELL_BROWSER_FINGERPRINT_FP_CLIENT_HINTS_DELEGATE_H_
#define SHELL_BROWSER_FINGERPRINT_FP_CLIENT_HINTS_DELEGATE_H_

#include <map>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "content/public/browser/client_hints_controller_delegate.h"

namespace electron {
class ElectronBrowserContext;
}  // namespace electron

namespace fp {

// 最小可用的 ClientHintsControllerDelegate：让导航请求的 Sec-CH-UA-*
// 头链路（content/browser/client_hints）在 Electron 下生效，行为对齐真
// Chrome。Accept-CH 按源站记忆在内存中（进程生命周期内有效）。
// UA metadata 经 BuildUserAgentMetadata 按分区 fp-config 下发。
class FpClientHintsDelegate : public content::ClientHintsControllerDelegate {
 public:
  explicit FpClientHintsDelegate(
      electron::ElectronBrowserContext* browser_context);
  ~FpClientHintsDelegate() override;

  // content::ClientHintsControllerDelegate:
  network::NetworkQualityTracker* GetNetworkQualityTracker() override;
  void GetAllowedClientHintsFromSource(
      const url::Origin& origin,
      blink::EnabledClientHints* client_hints) override;
  bool IsJavaScriptAllowed(const GURL& url,
                           content::RenderFrameHost* parent_rfh) override;
  blink::UserAgentMetadata GetUserAgentMetadata() override;
  void PersistClientHints(
      const url::Origin& primary_origin,
      content::RenderFrameHost* parent_rfh,
      const std::vector<network::mojom::WebClientHintsType>& client_hints)
      override;
  void SetAdditionalClientHints(
      const std::vector<network::mojom::WebClientHintsType>& hints) override;
  void ClearAdditionalClientHints() override;
  void SetMostRecentMainFrameViewportSize(
      const gfx::Size& viewport_size) override;
  gfx::Size GetMostRecentMainFrameViewportSize() override;

 private:
  raw_ptr<electron::ElectronBrowserContext> browser_context_;
  std::map<url::Origin, std::vector<network::mojom::WebClientHintsType>>
      persisted_hints_;
  std::vector<network::mojom::WebClientHintsType> additional_hints_;
  gfx::Size viewport_size_;
};

}  // namespace fp

#endif  // SHELL_BROWSER_FINGERPRINT_FP_CLIENT_HINTS_DELEGATE_H_
