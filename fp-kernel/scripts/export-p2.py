"""Export the three completed P2 features without rewriting source history.

The base is the last fp_40 commit in this v44.4.5 development tree. On an
upgrade, pass the corresponding pre-P2 commit with --base. Unrelated paths,
submodule states and the source index are never modified.
"""
import argparse
import datetime
import json
from pathlib import Path
import shutil
import subprocess
from paths import source_root, locked_base

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "third_party/blink/renderer/"
GROUPS = {
    "fp_41_rects_text_metrics.patch": ("fp_41: deterministic DOMRect and text metrics readback", [
        "core/dom/element.cc", "core/dom/range.cc", "core/geometry/dom_rect.cc", "core/geometry/dom_rect.h",
        "core/html/canvas/text_metrics.cc", "core/html/canvas/text_metrics.h",
        "modules/canvas/canvas2d/base_rendering_context_2d.cc",
        "platform/fingerprint/fingerprint_noise.cc", "platform/fingerprint/fingerprint_noise.h",
    ]),
    "fp_42_font_whitelist.patch": ("fp_42: filter resolved font families and local font enumeration", [
        "modules/font_access/font_access.cc", "platform/BUILD.gn",
        "platform/fingerprint/fingerprint_fonts.cc", "platform/fingerprint/fingerprint_fonts.h",
        "platform/fonts/font_cache.cc", "platform/fonts/win/font_cache_skia_win.cc",
    ]),
    "fp_43_media_speech.patch": ("fp_43: media enumeration and speech voice templates", [
        "modules/mediastream/media_devices.cc", "modules/speech/speech_synthesis.cc", "modules/speech/speech_synthesis.h",
    ]),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--base", default=locked_base('p2Base'))
    args = parser.parse_args()
    source = (args.source or Path(source_root())).resolve()
    base = subprocess.check_output(["git", "rev-parse", args.base + "^{commit}"], cwd=source, text=True).strip()
    date = datetime.datetime.now().astimezone().strftime("%a, %d %b %Y %H:%M:%S %z")
    exported = []
    for name, (subject, paths) in GROUPS.items():
        diff = subprocess.check_output(["git", "diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames", base, "--", *[PREFIX + path for path in paths]], cwd=source)
        if not diff:
            raise RuntimeError(f"No diff for {name}; refusing to replace an existing patch")
        header = f"From {'0' * 40} Mon Sep 17 00:00:00 2001\nFrom: fp <fp@local>\nDate: {date}\nSubject: {subject}\n\nBase: {base}\nIncludes acceptance fixes without rewriting development commits.\n\n"
        target = ROOT / "patches" / "chromium" / name
        target.write_bytes(header.encode() + diff)
        # Electron's patch manifest is needed by future sync/apply operations.
        shutil.copyfile(target, source / "electron" / "patches" / "chromium" / name)
        exported.append(name)
    manifest = source / "electron" / "patches" / "chromium" / ".patches"
    entries = manifest.read_text(encoding="utf-8").splitlines()
    for name in exported:
        if name not in entries:
            entries.append(name)
    manifest.write_text("\n".join(entries) + "\n", encoding="utf-8")
    for origin, target in [
        (source / PREFIX / "platform/fingerprint", ROOT / "src/blink/platform/fingerprint"),
        (source / "electron/shell/browser/fingerprint", ROOT / "src/shell/browser/fingerprint"),
    ]:
        target.mkdir(parents=True, exist_ok=True)
        for file in origin.iterdir():
            if file.is_file():
                shutil.copyfile(file, target / file.name)
    print(json.dumps(dict(base=base, exported=exported), indent=2))


if __name__ == "__main__":
    main()
