"""Exercise all three launch-path resolvers without starting a real app."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

PROJECT=Path(__file__).resolve().parents[3]

@unittest.skipUnless(os.name=='nt' and shutil.which('node'),'Windows launchers require Windows and Node')
class PortablePathsTests(unittest.TestCase):
    def test_launchers_agree_on_priority_unicode_and_relative_paths(self):
        with tempfile.TemporaryDirectory(prefix='fp-path-test-') as folder:
            root=Path(folder)/'中文目录';root.mkdir()
            for relative in ('scripts/runtime-path.js','fp-kernel/scripts/paths.py','fp-demo/scripts/launch.ps1'):
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(PROJECT/relative,target)
            for relative in ('runtime/electron.exe','runtime/版本/electron.exe','本机/electron.exe','环境/electron.exe'):
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'not executed')
            current=root/'runtime/current.json';local=root/'.fp-local.json';captured=root/'captured.txt'
            env=os.environ.copy();env.pop('FP_DEMO_ELECTRON',None)
            env.update(FP_PATH_MODULE=str(root/'scripts/runtime-path.js'),FP_PY_MODULE=str(root/'fp-kernel/scripts/paths.py'),
                       FP_LAUNCH_SCRIPT=str(root/'fp-demo/scripts/launch.ps1'),FP_CAPTURE_FILE=str(captured),PYTHONUTF8='1')
            fake_start="function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory) [IO.File]::WriteAllText($env:FP_CAPTURE_FILE,$FilePath,[Text.UTF8Encoding]::new($false)) }; & $env:FP_LAUNCH_SCRIPT"
            python_probe="import importlib.util,os; s=importlib.util.spec_from_file_location('paths',os.environ['FP_PY_MODULE']);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.electron_path())"
            cases=[('runtime/electron.exe',None,None,None),('本机/electron.exe',None,{'electron':'本机/electron.exe'},None),
                   ('runtime/版本/electron.exe',{'executable':'runtime/版本/electron.exe'},{'electron':'本机/electron.exe'},None),
                   ('本机/electron.exe',{}, {'electron':'本机/electron.exe'},None),('环境/electron.exe','invalid json','invalid json','环境/electron.exe')]
            for expected,current_data,local_data,override in cases:
                with self.subTest(expected=expected,current=current_data):
                    for file,value in ((current,current_data),(local,local_data)):
                        if value is None:
                            if file.exists():file.unlink()
                        else:file.write_text(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False),encoding='utf8')
                    if override:env['FP_DEMO_ELECTRON']=override
                    else:env.pop('FP_DEMO_ELECTRON',None)
                    node=subprocess.check_output(['node','-p','require(process.env.FP_PATH_MODULE).electronPath()'],env=env,text=True,encoding='utf8',timeout=15).strip()
                    python=subprocess.check_output([sys.executable,'-c',python_probe],env=env,text=True,encoding='utf8',timeout=15).strip()
                    subprocess.run(['powershell.exe','-NoProfile','-Command',fake_start],env=env,check=True,capture_output=True,timeout=15)
                    wanted=(root/expected).resolve()
                    for result in (node,python,captured.read_text(encoding='utf8')):self.assertEqual(Path(result).resolve(),wanted)

if __name__=='__main__':unittest.main()
