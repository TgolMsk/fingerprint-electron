// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "shell/browser/fingerprint/fp_locale.h"

#include <optional>
#include <string>

#include "base/base64.h"
#include "base/command_line.h"
#include "base/json/json_reader.h"
#include "base/values.h"
#include "shell/browser/fingerprint/fp_kernel.h"
#include "third_party/icu/source/common/unicode/locid.h"
#include "third_party/icu/source/common/unicode/utypes.h"

namespace fp {

void RestoreIcuLocaleFromConfig(const base::CommandLine& command_line) {
  if (!command_line.HasSwitch(kConfigSwitch))
    return;
  std::string json;
  if (!base::Base64Decode(command_line.GetSwitchValueASCII(kConfigSwitch),
                          &json, base::Base64DecodePolicy::kForgiving)) {
    return;
  }
  std::optional<base::DictValue> config =
      base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  if (!config.has_value())
    return;
  const base::ListValue* langs =
      config->FindListByDottedPath("navigator.languages");
  if (!langs || langs->empty() || !(*langs)[0].is_string())
    return;
  UErrorCode status = U_ZERO_ERROR;
  icu::Locale::setDefault(
      icu::Locale::forLanguageTag((*langs)[0].GetString(), status), status);
}

}  // namespace fp
