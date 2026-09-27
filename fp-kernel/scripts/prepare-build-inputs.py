"""Generate local build inputs from pinned DEPS and downloaded CIPD payloads."""
import sys
import json
import shutil
import hashlib
from pathlib import Path

root=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(root/'tools/depot_tools'))
import gclient_eval
from gclient import ToGNString

builtins={'host_os':'win','host_cpu':'x64','checkout_win':True,'checkout_linux':False,
          'checkout_mac':False,'checkout_android':False,'checkout_ios':False}
electron=gclient_eval.Exec((root/'src/electron/DEPS').read_text(),builtin_vars=builtins)
deps=gclient_eval.Exec((root/'src/DEPS').read_text(),vars_override=electron['vars'],builtin_vars=builtins)
variables=dict(builtins);variables.update(deps['vars']);variables.update(electron['vars'])
lines=["# Generated from 'DEPS'"]
for name in deps['gclient_gn_args']:
    value=variables[name]
    if isinstance(value,gclient_eval.ConstantString):value=value.value
    elif isinstance(value,str):value=gclient_eval.EvaluateCondition(value,variables)
    lines.append(f'{name} = {ToGNString(value)}')
target=(root/deps['gclient_gn_args_file']).resolve()
if not target.is_relative_to(root/'src'):raise ValueError('Generated GN args escape source root')
target.write_text('\n'.join(lines),encoding='utf8',newline='\n')
print(target)

# DevTools checks in JS dependencies, while Windows Rollup's native binary is
# delivered by CIPD. Reconstruct its platform package without npm resolution.
devtools=root/'src/third_party/devtools-frontend/src'
rollup=json.loads((devtools/'node_modules/rollup/package.json').read_text())
binary=devtools/'third_party/rollup_libs/rollup.win32-x64-msvc.node'
package=devtools/'node_modules/@rollup/rollup-win32-x64-msvc'
package.mkdir(parents=True,exist_ok=True)
target_binary=package/'rollup-win32-x64-msvc.node'
if not target_binary.exists() or hashlib.sha256(target_binary.read_bytes()).digest()!=hashlib.sha256(binary.read_bytes()).digest():
    shutil.copy2(binary,target_binary)
contents=json.dumps({'name':'@rollup/rollup-win32-x64-msvc','version':rollup['version'],'main':target_binary.name})+'\n'
package_file=package/'package.json'
if not package_file.exists() or package_file.read_text()!=contents:package_file.write_text(contents,encoding='utf8')
print(f'Rollup {rollup["version"]} Windows native module: {target_binary}')
