// Copyright 2026 The fp-kernel Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/fingerprint/fingerprint_config.h"

#include "base/base64.h"
#include "base/command_line.h"
#include "base/json/json_reader.h"
#include "base/no_destructor.h"

namespace fp {

namespace {

constexpr char kSwitchName[] = "fp-config";
constexpr int kSupportedSchemaVersion = 1;

// Maps a hook key to its dotted config path and the feature name checked
// against the "disable" list.
struct HookInfo {
  const char* path;
  const char* feature;
  bool is_double;
};

HookInfo InfoFor(HookKey key) {
  switch (key) {
    case HookKey::kUserAgent:
      return {"ua.string", "ua", false};
    case HookKey::kNavigatorPlatform:
      return {"navigator.platform", "navigator", false};
    case HookKey::kHardwareConcurrency:
      return {"navigator.hardwareConcurrency", "navigator", false};
    case HookKey::kDeviceMemory:
      return {"navigator.deviceMemory", "navigator", true};
    case HookKey::kTimezone:
      return {"timezone", "timezone", false};
    case HookKey::kScreenWidth:
      return {"screen.width", "screen", false};
    case HookKey::kScreenHeight:
      return {"screen.height", "screen", false};
    case HookKey::kScreenAvailWidth:
      return {"screen.availWidth", "screen", false};
    case HookKey::kScreenAvailHeight:
      return {"screen.availHeight", "screen", false};
    case HookKey::kScreenColorDepth:
      return {"screen.colorDepth", "screen", false};
    case HookKey::kDevicePixelRatio:
      return {"screen.dpr", "screen", true};
    case HookKey::kWebGLVendor:
      return {"webgl.vendor", "webgl", false};
    case HookKey::kWebGLRenderer:
      return {"webgl.renderer", "webgl", false};
  }
}

// FNV-1a 64 over the input, followed by a splitmix64 finalizer. Uses only
// fixed-width arithmetic so results are identical on every platform and run.
uint64_t StableHash(std::string_view a, std::string_view b) {
  uint64_t h = 14695981039346656037ull;
  auto mix = [&h](std::string_view s) {
    for (char c : s) {
      h ^= static_cast<uint8_t>(c);
      h *= 1099511628211ull;
    }
    h ^= 0xffull;  // separator between the two parts
  };
  mix(a);
  mix(b);
  h ^= h >> 30;
  h *= 0xbf58476d1ce4e5b9ull;
  h ^= h >> 27;
  h *= 0x94d049bb133111ebull;
  h ^= h >> 31;
  return h;
}

}  // namespace

FingerprintConfig& FingerprintConfig::Get() {
  static base::NoDestructor<FingerprintConfig> instance;
  return *instance;
}

FingerprintConfig::FingerprintConfig() {
  const base::CommandLine* cmd = base::CommandLine::ForCurrentProcess();
  if (!cmd->HasSwitch(kSwitchName))
    return;

  std::string json;
  if (!base::Base64Decode(cmd->GetSwitchValueASCII(kSwitchName), &json,
                          base::Base64DecodePolicy::kForgiving)) {
    return;
  }

  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  if (!parsed.has_value())
    return;

  // Unknown fields are ignored; a newer schema we do not understand is
  // rejected wholesale so an old kernel never misinterprets a new config.
  std::optional<int> schema = parsed->FindInt("schemaVersion");
  if (schema.has_value() && *schema > kSupportedSchemaVersion)
    return;

  const std::string* seed = parsed->FindString("seed");
  if (!seed || seed->empty())
    return;

  seed_ = *seed;
  dict_ = std::move(*parsed);
  enabled_ = true;
}

bool FingerprintConfig::IsDisabled(std::string_view feature) const {
  if (!enabled_)
    return false;
  const base::ListValue* list = dict_.FindList("disable");
  if (!list)
    return false;
  for (const base::Value& item : *list) {
    if (item.is_string() && item.GetString() == feature)
      return true;
  }
  return false;
}

std::optional<std::string> FingerprintConfig::GetString(
    std::string_view dotted_path) const {
  if (!enabled_)
    return std::nullopt;
  const std::string* value = dict_.FindStringByDottedPath(dotted_path);
  if (!value)
    return std::nullopt;
  return *value;
}

std::optional<int64_t> FingerprintConfig::GetInt(
    std::string_view dotted_path) const {
  if (!enabled_)
    return std::nullopt;
  std::optional<int> value = dict_.FindIntByDottedPath(dotted_path);
  if (!value.has_value())
    return std::nullopt;
  return static_cast<int64_t>(*value);
}

std::optional<double> FingerprintConfig::GetDouble(
    std::string_view dotted_path) const {
  if (!enabled_)
    return std::nullopt;
  return dict_.FindDoubleByDottedPath(dotted_path);
}

std::optional<bool> FingerprintConfig::GetBool(
    std::string_view dotted_path) const {
  if (!enabled_)
    return std::nullopt;
  return dict_.FindBoolByDottedPath(dotted_path);
}

std::optional<std::vector<std::string>> FingerprintConfig::GetStringList(
    std::string_view dotted_path) const {
  if (!enabled_)
    return std::nullopt;
  const base::ListValue* list = dict_.FindListByDottedPath(dotted_path);
  if (!list)
    return std::nullopt;
  std::vector<std::string> out;
  out.reserve(list->size());
  for (const base::Value& item : *list) {
    if (!item.is_string())
      return std::nullopt;
    out.push_back(item.GetString());
  }
  return out;
}

uint64_t FingerprintConfig::NoiseUInt64(std::string_view purpose) const {
  return StableHash(seed_, purpose);
}

double FingerprintConfig::NoiseUnit(std::string_view purpose) const {
  // 53 significant bits, matching JS-number-friendly precision.
  return static_cast<double>(NoiseUInt64(purpose) >> 11) /
         9007199254740992.0;
}

int64_t FingerprintConfig::NoiseInt(std::string_view purpose,
                                    int64_t min,
                                    int64_t max) const {
  if (max <= min)
    return min;
  uint64_t span = static_cast<uint64_t>(max - min) + 1;
  return min + static_cast<int64_t>(NoiseUInt64(purpose) % span);
}

int64_t Hook(HookKey key, int64_t original) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  HookInfo info = InfoFor(key);
  if (!cfg.Enabled() || cfg.IsDisabled(info.feature))
    return original;
  if (info.is_double) {
    std::optional<double> value = cfg.GetDouble(info.path);
    return value.has_value() ? static_cast<int64_t>(*value) : original;
  }
  std::optional<int64_t> value = cfg.GetInt(info.path);
  return value.has_value() ? *value : original;
}

unsigned Hook(HookKey key, unsigned original) {
  return static_cast<unsigned>(Hook(key, static_cast<int64_t>(original)));
}

double Hook(HookKey key, double original) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  HookInfo info = InfoFor(key);
  if (!cfg.Enabled() || cfg.IsDisabled(info.feature))
    return original;
  std::optional<double> value = cfg.GetDouble(info.path);
  if (value.has_value())
    return *value;
  std::optional<int64_t> int_value = cfg.GetInt(info.path);
  return int_value.has_value() ? static_cast<double>(*int_value) : original;
}

blink::String Hook(HookKey key, const blink::String& original) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  HookInfo info = InfoFor(key);
  if (!cfg.Enabled() || cfg.IsDisabled(info.feature))
    return original;
  std::optional<std::string> value = cfg.GetString(info.path);
  if (!value.has_value())
    return original;
  return blink::String::FromUtf8(*value);
}

void HookWebGPUAdapter(blink::String& vendor, blink::String& description) {
  const FingerprintConfig& cfg = FingerprintConfig::Get();
  if (!cfg.Enabled() || cfg.IsDisabled("webgl"))
    return;
  std::optional<std::string> renderer = cfg.GetString("webgl.renderer");
  if (!renderer.has_value())
    return;
  const std::string& r = *renderer;
  constexpr size_t kNotFound = std::string::npos;
  std::string derived_vendor;
  if (r.find("NVIDIA") != kNotFound)
    derived_vendor = "nvidia";
  else if (r.find("Intel") != kNotFound)
    derived_vendor = "intel";
  else if (r.find("AMD") != kNotFound)
    derived_vendor = "amd";
  if (!derived_vendor.empty())
    vendor = blink::String::FromUtf8(derived_vendor);

  // ANGLE 格式：ANGLE (<厂商>, <卡名> <后端>, <驱动>) → 取卡名、去后端后缀
  size_t first_comma = r.find(',');
  if (first_comma == kNotFound)
    return;
  size_t start = r.find_first_not_of(' ', first_comma + 1);
  if (start == kNotFound)
    return;
  size_t second_comma = r.find(',', start);
  std::string card = r.substr(
      start, second_comma == kNotFound ? kNotFound : second_comma - start);
  for (const char* suffix : {" Direct3D", " Vulkan", " OpenGL", " Metal"}) {
    size_t pos = card.find(suffix);
    if (pos != kNotFound)
      card.erase(pos);
  }
  if (!card.empty())
    description = blink::String::FromUtf8(card);
}

}  // namespace fp
