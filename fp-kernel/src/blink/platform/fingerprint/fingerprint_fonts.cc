// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_fonts.h"

#include <algorithm>

#include <set>

#include "base/no_destructor.h"

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_config.h"

namespace fp {

namespace {

// Windows 11 默认字体集（模板 "win-default"），小写排序便于二分。
// 与声称的系统保持一致是硬约束；Win10 模板后续按需增补。
constexpr const char* kWinDefaultFonts[] = {
    "arial",
    "arial black",
    "bahnschrift",
    "calibri",
    "cambria",
    "candara",
    "comic sans ms",
    "consolas",
    "constantia",
    "corbel",
    "courier new",
    "ebrima",
    "franklin gothic",
    "gabriola",
    "gadugi",
    "georgia",
    "hololens mdl2 assets",
    "impact",
    "ink free",
    "javanese text",
    "leelawadee ui",
    "lucida console",
    "lucida sans unicode",
    "malgun gothic",
    "microsoft himalaya",
    "microsoft jhenghei",
    "microsoft new tai lue",
    "microsoft phagspa",
    "microsoft sans serif",
    "microsoft tai le",
    "microsoft yahei",
    "microsoft yi baiti",
    "mingliu-extb",
    "ms gothic",
    "ms pgothic",
    "ms ui gothic",
    "mv boli",
    "myanmar text",
    "nirmala ui",
    "nsimsun",
    "palatino linotype",
    "pmingliu-extb",
    "segoe fluent icons",
    "segoe mdl2 assets",
    "segoe print",
    "segoe script",
    "segoe ui",
    "segoe ui emoji",
    "segoe ui historic",
    "segoe ui symbol",
    "simsun",
    "simsun-extb",
    "sitka",
    "sylfaen",
    "symbol",
    "tahoma",
    "times new roman",
    "trebuchet ms",
    "verdana",
    "webdings",
    "wingdings",
    "yu gothic",
};

}  // namespace

bool FontsFilterEnabled() {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("fonts"))
    return false;
  std::optional<std::string> tpl = cfg.GetString("fonts");
  return tpl.has_value() && *tpl == "win-default";
}

bool FontAllowed(const blink::String& family) {
  std::string key;
  key.reserve(family.length());
  for (char c : family.Ascii())
    key.push_back(c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c);
  static const base::NoDestructor<std::set<std::string>> kWhitelist([] {
    std::set<std::string> s;
    for (const char* f : kWinDefaultFonts)
      s.insert(f);
    return s;
  }());
  return kWhitelist->count(key) > 0;
}

}  // namespace fp
