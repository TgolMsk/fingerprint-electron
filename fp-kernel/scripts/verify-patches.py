#!/usr/bin/env python3
"""Replay fp_*.patch in a temporary directory; never mutate the source checkout.

Exit codes: 0 = replay and comparison passed; 1 = replay failure or drift;
2 = invalid inputs or an operational error. Only CRLF/LF differences are ignored.
The JSON report is printed to stdout and optionally written with --output.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from paths import source_root, locked_base


class VerificationError(Exception):
    pass


def command(args: list[str], cwd: Path) -> subprocess.CompletedProcess[bytes]:
    # Do not inherit index/worktree redirection from a developer's shell.
    env = dict(os.environ)
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        env.pop(name, None)
    env["GIT_OPTIONAL_LOCKS"] = "0"
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, timeout=120)


def git(args: list[str], cwd: Path) -> bytes:
    result = command(["git", *args], cwd)
    if result.returncode:
        raise VerificationError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


def safe_path(raw: bytes) -> str:
    path = os.fsdecode(raw)
    parsed = PurePosixPath(path)
    if (not path or parsed.is_absolute() or ".." in parsed.parts
            or "\\" in path or ":" in path or "\0" in path
            or ".git" in {part.lower() for part in parsed.parts}):
        raise VerificationError(f"Unsafe patch path: {path!r}")
    return parsed.as_posix()


def unquote_git_path(raw: bytes) -> bytes:
    """Decode Git's C-style quoting (including octal-escaped UTF-8 bytes)."""
    if not raw.startswith(b'"'):
        return raw
    if not raw.endswith(b'"'):
        raise VerificationError("Unterminated quoted Git path")
    raw = raw[1:-1]
    output = bytearray()
    escapes = {ord("a"): 7, ord("b"): 8, ord("t"): 9, ord("n"): 10,
               ord("v"): 11, ord("f"): 12, ord("r"): 13,
               ord('"'): 34, ord("\\"): 92}
    index = 0
    while index < len(raw):
        value = raw[index]
        index += 1
        if value != 92:
            output.append(value)
        elif index < len(raw) and 48 <= raw[index] <= 55:
            end = index
            while end < min(index + 3, len(raw)) and 48 <= raw[end] <= 55:
                end += 1
            output.append(int(raw[index:end], 8))
            index = end
        elif index < len(raw) and raw[index] in escapes:
            output.append(escapes[raw[index]])
            index += 1
        else:
            raise VerificationError("Unsupported escape in quoted Git path")
    return bytes(output)


def patch_paths(patch: Path, cwd: Path) -> list[str]:
    records = git(["apply", "--numstat", "-z", str(patch)], cwd).split(b"\0")
    paths = set()
    index = 0
    while index < len(records) and records[index]:
        record = records[index].split(b"\t", 2)
        index += 1
        if len(record) != 3:
            raise VerificationError(f"Malformed numstat for {patch.name}")
        if record[2]:
            paths.add(safe_path(record[2]))
        else:  # Git's -z rename representation: counts, old path, new path.
            if index + 1 >= len(records):
                raise VerificationError(f"Incomplete rename numstat for {patch.name}")
            paths.update(safe_path(item) for item in records[index:index + 2])
            index += 2
    # git apply --numstat can report only a rename/copy destination. Include sources.
    for line in patch.read_bytes().splitlines():
        for prefix in (b"rename from ", b"rename to ", b"copy from ", b"copy to "):
            if line.startswith(prefix):
                paths.add(safe_path(unquote_git_path(line[len(prefix):])))
        if line.startswith((b"new file mode 120000", b"new file mode 160000",
                            b"new mode 120000", b"new mode 160000")):
            raise VerificationError(f"Symlink/submodule creation is unsupported: {patch.name}")
    if not paths:
        raise VerificationError(f"Patch has no file changes: {patch.name}")
    return sorted(paths)


def contained(root: Path, relative: str) -> Path:
    path = root.joinpath(*PurePosixPath(relative).parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise VerificationError(f"Path resolves outside its root: {relative}")
    return path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compare_file(replay: Path, source: Path, relative: str) -> dict:
    result = {"path": relative}
    replay_path, source_path = contained(replay, relative), contained(source, relative)
    if replay_path.is_symlink() or source_path.is_symlink():
        raise VerificationError(f"Symlink comparison is unsupported: {relative}")
    actual = replay_path.read_bytes() if replay_path.exists() else None
    expected = source_path.read_bytes() if source_path.exists() else None
    result.update(replay_sha256=sha256(actual) if actual is not None else None,
                  source_sha256=sha256(expected) if expected is not None else None)
    if actual == expected:
        result["status"] = "identical" if actual is not None else "both_absent"
    elif actual is None:
        result["status"] = "missing_in_replay"
    elif expected is None:
        result["status"] = "missing_in_source"
    else:
        try:
            a = actual.decode("utf-8").replace("\r\n", "\n")
            b = expected.decode("utf-8").replace("\r\n", "\n")
        except UnicodeDecodeError:
            result["status"] = "binary_drift"
        else:
            if a == b:
                result["status"] = "line_endings_only"
            else:
                result["status"] = "text_drift"
                diff = list(difflib.unified_diff(a.splitlines(keepends=True), b.splitlines(keepends=True),
                                                fromfile=f"replay/{relative}", tofile=f"source/{relative}", n=3))
                result["diff"] = "".join(diff[:200])
                result["diff_truncated"] = len(diff) > 200
    return result


def verify(args: argparse.Namespace, report: dict) -> int:
    source = Path(args.source).resolve()
    patches = Path(args.patches).resolve()
    if not source.is_dir() or not patches.is_dir():
        raise VerificationError("--source and --patches must be existing directories")
    files = sorted(patches.glob("fp_*.patch"), key=lambda path: path.name)
    if not files:
        raise VerificationError(f"No fp_*.patch files in {patches}")
    base = git(["rev-parse", "--verify", f"{args.base}^{{commit}}"], source).decode().strip()
    report.update(source=str(source), patches_directory=str(patches), base_expression=args.base,
                  base_commit=base, source_head=git(["rev-parse", "HEAD"], source).decode().strip(),
                  patch_count=len(files), replay_complete=False, patches=[], comparisons=[])
    # tempfile creates the only writable replay tree; no checkout/index/branch operations.
    with tempfile.TemporaryDirectory(prefix="fp-patch-replay-") as temporary:
        replay = Path(temporary) / "tree"
        replay.mkdir()
        inputs = Path(temporary) / "inputs"
        inputs.mkdir()
        report["temporary_replay"] = str(replay)
        all_paths = set()
        snapshots = []
        for patch in files:
            # Parse and apply the same bytes even if another task exports patches concurrently.
            data = patch.read_bytes()
            snapshot = inputs / patch.name
            snapshot.write_bytes(data)
            snapshots.append(snapshot)
            paths = patch_paths(snapshot, replay)
            report["patches"].append({"name": patch.name, "sha256": sha256(data),
                                       "paths": paths, "status": "pending"})
            all_paths.update(paths)
        tree = git(["ls-tree", "-r", "--full-tree", "-z", base, "--", *sorted(all_paths)], source)
        existing = {}
        for entry in tree.split(b"\0"):
            if not entry:
                continue
            metadata, raw_path = entry.split(b"\t", 1)
            mode, kind, oid = metadata.split()
            relative = safe_path(raw_path)
            if kind != b"blob" or mode not in (b"100644", b"100755"):
                raise VerificationError(f"Unsupported baseline file mode: {relative} {mode!r}")
            existing[relative] = oid.decode()
        report["baseline_files"] = len(existing)
        report["paths_absent_at_baseline"] = sorted(all_paths - existing.keys())
        for relative, oid in existing.items():
            target = contained(replay, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(git(["show", oid], source))
        for patch, entry in zip(snapshots, report["patches"]):
            for operation, options in (("check", ["--check"]), ("apply", [])):
                result = command(["git", "apply", "--whitespace=nowarn", *options, str(patch)], replay)
                entry[f"{operation}_exit_code"] = result.returncode
                if result.stderr:
                    entry[f"{operation}_stderr"] = result.stderr.decode("utf-8", "replace").strip()
                if result.returncode:
                    entry["status"] = f"{operation}_failed"
                    report["failure"] = f"{patch.name}: git apply {operation} failed"
                    report["comparison_skipped"] = "Ordered replay is incomplete; partial output is not a final-state comparison."
                    return 1
            entry["status"] = "applied"
        report["replay_complete"] = True
        report["comparisons"] = [compare_file(replay, source, relative) for relative in sorted(all_paths)]
        good = {"identical", "both_absent", "line_endings_only"}
        report["drift"] = [entry["path"] for entry in report["comparisons"] if entry["status"] not in good]
        report["file_count"] = len(report["comparisons"])
        report["identical_files"] = sum(entry["status"] == "identical" for entry in report["comparisons"])
        report["line_ending_only_files"] = sum(entry["status"] == "line_endings_only" for entry in report["comparisons"])
        report["source_head_after"] = git(["rev-parse", "HEAD"], source).decode().strip()
        if report["source_head_after"] != report["source_head"]:
            report["failure"] = "Source HEAD changed concurrently during verification; rerun on a stable checkout."
            return 1
        return 1 if report["drift"] else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Read-only Chromium working tree; or FP_SOURCE_ROOT")
    parser.add_argument("--patches", default=str(Path(__file__).resolve().parents[1] / "patches" / "chromium"))
    parser.add_argument("--base", default=locked_base('chromiumFpBase'), help="Base commit before the first FP commit")
    parser.add_argument("--output", help="Optional JSON report path (default: stdout only)")
    args = parser.parse_args()
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "normalization": "UTF-8 CRLF to LF only"}
    try:
        args.source = args.source or source_root()
        if args.output and Path(args.output).resolve().is_relative_to(Path(args.source).resolve()):
            raise VerificationError("--output must not be inside the read-only source tree")
        code = verify(args, report)
    except (VerificationError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        report["error"] = str(error)
        code = 2
    report.update(finished_at=datetime.now(timezone.utc).isoformat(), passed=code == 0, exit_code=code)
    content = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        output = Path(args.output).resolve()
        if not args.source or not output.is_relative_to(Path(args.source).resolve()):
            try:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(content, encoding="utf-8")
            except OSError as error:
                report.update(output_error=str(error), passed=False, exit_code=2)
                content = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
                code = 2
    sys.stdout.write(content)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
