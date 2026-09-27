"""Run Electron acceptance scripts with isolated profiles and retained evidence."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from paths import electron_path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tests", nargs="*", help="Paths relative to fp-kernel")
    parser.add_argument("--electron", default=electron_path())
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()
    tests = args.tests or ["tests/phase2/accept.js"] + [str(p.relative_to(ROOT)) for p in sorted((ROOT / "tests/phase3").glob("accept*.js"))]
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    output = ROOT / "test-results" / stamp
    output.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    summaries = []
    for test in tests:
        script = (ROOT / test).resolve()
        profile = tempfile.mkdtemp(prefix="fp-accept-")
        name = f"{script.parent.name}-{script.stem}"
        stdout = output / f"{name}.stdout.log"
        stderr = output / f"{name}.stderr.log"
        started = datetime.datetime.now().isoformat()
        timed_out = False
        with stdout.open("wb") as out, stderr.open("wb") as err:
            proc = subprocess.Popen([args.electron, str(script), f"--user-data-dir={profile}"], cwd=ROOT, env=env, stdout=out, stderr=err, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                code = proc.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
                else:
                    proc.kill()
                code = proc.wait()
        content = stdout.read_text(encoding="utf-8", errors="replace")
        passed = len(re.findall(r"^PASS\b", content, re.M))
        failed = len(re.findall(r"^FAIL\b", content, re.M))
        ok = code == 0 and not timed_out and passed > 0 and failed == 0 and "ALL PASS" in content
        summaries.append(dict(test=test, started=started, exitCode=code, timeout=timed_out, passed=passed, failed=failed, ok=ok, profile=profile, stdout=str(stdout), stderr=str(stderr)))
        print(f"{'PASS' if ok else 'FAIL'} {test}: {passed} passed, {failed} failed, exit={code}, timeout={timed_out}", flush=True)
        if not ok:
            print(content[-12000:], flush=True)
    result = dict(created=datetime.datetime.now().isoformat(), electron=args.electron, tests=summaries, ok=all(item["ok"] for item in summaries))
    (output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Evidence: {output}", flush=True)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
