#!/usr/bin/env python3
"""Locked, fail-fast Windows build and local release pipeline. Never publishes."""
from __future__ import annotations
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

KERNEL = Path(__file__).resolve().parents[1]
PROJECT = KERNEL.parent
DEFAULT_LOCK = KERNEL / 'build/lock.json'

def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def copy_cached_file(source, target):
    # CIPD payloads are often read-only. Resume never overwrites verified files.
    if Path(target).exists():
        if sha(source) != sha(target): raise ValueError(f'Cached dependency differs: {target}')
        return str(target)
    return shutil.copy2(source, target)

def brief(error):
    if isinstance(error, shutil.Error):return '\n'.join(str(x) for x in error.args[0][:3])
    return str(error)[-4000:]

def write_json(file, data):
    file = Path(file); file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(file)

def contained(root, relative):
    name = PurePosixPath(relative)
    if name.is_absolute() or '..' in name.parts or ':' in relative or '\\' in relative:
        raise ValueError(f'Unsafe relative path: {relative}')
    target = (Path(root) / relative).resolve()
    if not target.is_relative_to(Path(root).resolve()): raise ValueError(f'Path escapes root: {relative}')
    return target

def clean_env():
    env = os.environ.copy()
    for key in ('GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','ELECTRON_RUN_AS_NODE','PYTHONHOME','PYTHONPATH','NODE_PATH'):
        env.pop(key, None)
    env.update(PYTHONUTF8='1', DEPOT_TOOLS_UPDATE='0', GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never', GIT_LFS_SKIP_SMUDGE='1')
    return env

def output(args, cwd=None):
    return subprocess.check_output([str(x) for x in args], cwd=cwd, env=clean_env(), encoding='utf-8',timeout=120).strip()

def git(repo, *args): return output(['git','-C',repo,*args])

def read_lock(file):
    lock = json.loads(Path(file).read_text(encoding='utf-8'))
    if lock.get('schemaVersion') != 1: raise ValueError('Unsupported lock schema')
    for group in lock['patches'].values():
        for item in group:
            file = contained(KERNEL, item['path'])
            if sha(file) != item['sha256']: raise ValueError(f'Patch checksum mismatch: {file}')
    return lock

class Run:
    def __init__(self, root, lock_file, create=False, resume=False):
        self.root = Path(root).resolve(); self.lock_file = Path(lock_file).resolve()
        self.lock = read_lock(self.lock_file); self.state_file = self.root / '.fp-build-state.json'
        self.skip_completed = create and resume
        if create and not resume:
            if self.root.exists() and any(self.root.iterdir()): raise ValueError('Workspace must be new or empty; existing source is never reset.')
            self.root.mkdir(parents=True, exist_ok=True)
            self.state = dict(schemaVersion=1, lockSha256=sha(self.lock_file), createdAt=time.time(), steps=[], status='preparing')
            write_json(self.root / 'build-lock.json', self.lock)
        else:
            self.state = json.loads(self.state_file.read_text(encoding='utf-8'))
            if self.state['lockSha256'] != sha(self.lock_file): raise ValueError('Lock changed since workspace creation; use a new workspace.')
            if create and resume: self.state['status'] = 'preparing'
        self.env = clean_env(); self.save()

    def save(self): write_json(self.state_file, self.state)

    def command(self, label, args, cwd=None):
        if self.skip_completed:
            completed=[s for s in self.state['steps'] if s.get('label')==label and s.get('exitCode')==0 and not s.get('retired')]
            if completed:
                if any(s.get('command')==[str(x) for x in args] for s in completed):return
                raise ValueError(f'Resume recipe changed at {label}; use a new workspace instead of repeating a successful mutation')
        print(f'[{label}]', flush=True)
        log = self.root / 'logs' / f'{len(self.state["steps"]):03d}-{re.sub(r"[^a-zA-Z0-9_-]", "_", label)}.log'
        log.parent.mkdir(exist_ok=True)
        entry = dict(label=label, command=[str(x) for x in args], startedAt=time.time(), log=log.relative_to(self.root).as_posix())
        self.state['steps'].append(entry); self.save()
        try:
            with log.open('wb') as stream:
                result = subprocess.run([str(x) for x in args], cwd=cwd or self.root, env=self.env, stdout=stream, stderr=subprocess.STDOUT)
            entry.update(exitCode=result.returncode, finishedAt=time.time()); self.save()
            if result.returncode:
                raise RuntimeError(f'{label} failed ({result.returncode}); log: {log}\n{log.read_text(encoding="utf8",errors="replace")[-3000:]}')
        except BaseException as error:
            self.state.update(status='failed', failedStep=label, error=str(error)); self.save(); raise

    def clone(self, rel, url, commit, reference=None):
        dest = contained(self.root, rel)
        if dest.exists() and any(dest.iterdir()) and not self.skip_completed: raise ValueError(f'Checkout destination not empty: {dest}')
        dest.parent.mkdir(parents=True, exist_ok=True)
        source = str(reference) if reference and Path(reference).exists() else url
        self.command('clone-' + rel, ['git','-c','core.longpaths=true','clone','--no-checkout',source,dest])
        self.command('configure-' + rel, ['git','-C',dest,'config','core.autocrlf','false'])
        self.command('longpaths-' + rel, ['git','-C',dest,'config','core.longpaths','true'])
        self.command('remote-' + rel, ['git','-C',dest,'remote','set-url','origin',url])
        self.command('checkout-' + rel, ['git','-C',dest,'checkout','--detach',commit])
        self.command('identity-' + rel, ['git','-C',dest,'config','user.name','FP Build'])
        self.command('email-' + rel, ['git','-C',dest,'config','user.email','build@fp.invalid'])

def build_environment(run, depot, toolchain=None, windows_sdk=None):
    depot = Path(depot).resolve()
    python_dir = depot / (depot/'python3_bin_reldir.txt').read_text().strip()
    python = python_dir / 'python3.exe'
    if not python.is_file(): raise ValueError(f'Pinned depot_tools Python is missing: {python}')
    version = output([python,'--version']).split()[-1]
    if version != run.lock['toolchain']['buildPython']: raise ValueError(f'Build Python mismatch: {version}')
    run.env['PATH'] = os.pathsep.join([str(python_dir),str(depot),str(run.root/'src/third_party/ninja'),run.env['PATH']])
    run.env.update(CHROMIUM_BUILDTOOLS_PATH=str(run.root/'src/buildtools'), DEPOT_TOOLS_WIN_TOOLCHAIN='0')
    if toolchain:
        toolchain = Path(toolchain).resolve()
        sdk=Path(windows_sdk).resolve() if windows_sdk else toolchain/'Windows Kits/10'
        year=run.lock['toolchain']['visualStudioYear']
        run.env.update(GYP_MSVS_OVERRIDE_PATH=str(toolchain),GYP_MSVS_VERSION=year,WINDOWSSDKDIR=str(sdk))
        run.env[('vs'+year+'_install').upper()]=str(toolchain)
        if all((toolchain/name).is_dir() for name in ('sys64','sys32')):
            # Recreate machine-local configuration instead of copying stale paths.
            write_json(run.root/'src/build/win_toolchain.json',dict(path=str(toolchain),version=run.lock['toolchain']['visualStudioYear'],
                win_sdk=str(sdk),wdk=str(toolchain/'wdk'),
                runtime_dirs=[str(toolchain/name) for name in ('sys64','sys32','sysarm64')]))
            run.env['DEPOT_TOOLS_WIN_TOOLCHAIN']='1'
    return python

def verify_trees(run):
    results = []
    for item in run.lock['sources']['repositories']:
        repo = contained(run.root,item['path'])
        tree = git(repo,'rev-parse','HEAD^{tree}')
        dirty = git(repo,'status','--porcelain','--untracked-files=no','--ignore-submodules=all')
        results.append(dict(path=item['path'], expected=item['expectedTree'], actual=tree, passed=tree==item['expectedTree'] and not dirty))
    write_json(run.root/'source-verification.json',dict(passed=all(r['passed'] for r in results),repositories=results))
    failures = [r['path'] for r in results if not r['passed']]
    if failures: raise ValueError(f'Source tree drift: {failures}')

def seed_assets(reference, destination):
    # Only build dependencies; never copy out/, browser profiles or user files.
    names = ['src/buildtools/win','src/third_party/llvm-build','src/third_party/rust-toolchain',
             'src/third_party/node','src/third_party/ninja','src/third_party/siso/cipd',
             'src/third_party/depot_tools/win_toolchain', 'src/electron/node_modules',
             'src/electron/.yarn/cache', 'src/third_party/angle/third_party/glslang/src',
             'src/third_party/instrumented_libs/binaries','src/build/toolchain/win/rc/win']
    entries_file=Path(reference)/'.gclient_entries'
    if entries_file.exists():
        entries=ast.literal_eval(entries_file.read_text().split('=',1)[1])
        # gclient stores non-Git downloads as path:package keys. Some GN files
        # reference test-data BUILD.gn files even for a distribution-only build.
        for name in entries:
            if ':' not in name:continue
            relative=name.split(':',1)[0]
            if relative.startswith('src/') and '/out/' not in relative and relative not in names:names.append(relative)
    copied = []
    for name in names:
        src = contained(reference,name)
        if not src.exists(): continue
        # Tracked files in asset directories are identical and checked afterwards.
        shutil.copytree(src,contained(destination,name),dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git'),copy_function=copy_cached_file)
        copied.append(name)
    return copied

def write_gclient_entries(workspace, repositories, reference=None, copied=()):
    entries={item['path']:item['url']+'@'+item['commit'] for item in repositories}
    cached=Path(reference)/'.gclient_entries' if reference else None
    if cached and cached.exists():
        # Preserve downloaded-package registrations so this workspace can itself
        # seed another clean build. capture-lock intentionally skips these keys.
        for name,value in ast.literal_eval(cached.read_text(encoding='utf8').split('=',1)[1]).items():
            if ':' in name and name.split(':',1)[0] in copied:entries[name]=value
    (Path(workspace)/'.gclient_entries').write_text('entries = '+repr(entries)+'\n',encoding='utf8')

def prepare(args):
    run = Run(args.workspace,args.lock,create=True,resume=args.resume)
    try:
        reference = Path(args.reference).resolve() if args.reference else None
        depot_ref = Path(args.depot_tools).resolve() if args.depot_tools else None
        depot = run.root/'tools/depot_tools'
        d = run.lock['sources']['depotTools']
        run.clone('tools/depot_tools',d['url'],d['commit'],depot_ref)
        if depot_ref:
            bin_rel = (depot_ref/'python3_bin_reldir.txt').read_text().strip()
            shutil.copytree(depot_ref/bin_rel,depot/bin_rel,dirs_exist_ok=True,copy_function=copy_cached_file)
            shutil.copy2(depot_ref/'python3_bin_reldir.txt',depot/'python3_bin_reldir.txt')
        else:
            # Bootstrap the exact pinned depot_tools checkout, with auto-update disabled.
            run.command('bootstrap-depot', ['cmd.exe','/d','/c',str(depot/'python3.bat'),'--version'])
        # Source-local toolchain metadata must not make src nonempty before clone.
        python = build_environment(run,depot)
        repositories = run.lock['sources']['repositories'] if reference else [x for x in run.lock['sources']['repositories'] if x['path'] in ('src','src/electron')]
        for item in repositories:
            run.clone(item['path'],item['url'],item['commit'],reference/item['path'] if reference else None)
        electron = run.root/'src/electron'
        run.command('disable-electron-commit-signing',['git','-C',electron,'config','commit.gpgsign','false'])
        for patch in run.lock['patches']['electron']:
            run.command(Path(patch['path']).stem,['git','-C',electron,'am',KERNEL/patch['path']])
        patch_dir = electron/'patches/chromium'
        registry = patch_dir/'.patches'
        lines = registry.read_text().splitlines()
        for patch in run.lock['patches']['chromium']:
            src = KERNEL/patch['path']; target = patch_dir/src.name
            if src.name in lines:
                if not args.resume or sha(target) != patch['sha256']: raise ValueError(f'Existing Chromium patch differs: {src.name}')
            else:
                shutil.copy2(src,target); lines.append(src.name)
        registry.write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
        run.command('register-patches',['git','-C',electron,'add','patches/chromium'])
        run.command('commit-patches',['git','-C',electron,'commit','-m','Register locked FP Chromium patches'])
        (run.root/'.gclient').write_text("solutions = [{'name':'src/electron','url':'https://github.com/electron/electron.git','deps_file':'DEPS','managed':False,'custom_deps':{},'custom_vars':{}}]\n",encoding='utf8')
        if args.windows_toolchain:
            build_environment(run,depot,args.windows_toolchain,args.windows_sdk)
        if reference:
            run.state['assetCacheCopies'] = seed_assets(reference,run.root); run.save()
            run.command('apply-upstream-and-fp-patches',[python,electron/'script/apply_all_patches.py','src/electron/patches/config.json'])
            write_gclient_entries(run.root,run.lock['sources']['repositories'],reference,run.state['assetCacheCopies'])
        else:
            run.command('sync-locked-dependencies',[python,depot/'gclient.py','sync','--with_branch_heads','--with_tags'])
        verify_trees(run)
        run.state.update(status='prepared', sourceVerification='source-verification.json', cleanOutput=True); run.save()
        print(f'PREPARED {run.root}',flush=True)
    except BaseException as error:
        run.state.update(status='failed',error=brief(error));run.save();raise

def doctor(args):
    lock=read_lock(args.lock); checks=[]
    for label,cmd,want in [('node',['node','--version'],'v'+lock['toolchain']['hostNode']),('python',[sys.executable,'--version'],'Python '+lock['toolchain']['hostPython']),('git',['git','--version'],'git version '+lock['toolchain']['git'])]:
        try: actual=output(cmd)
        except Exception as e: actual=str(e)
        checks.append(dict(name=label,expected=want,actual=actual,passed=actual==want))
    if args.windows_toolchain:
        root=Path(args.windows_toolchain)
        sdk=Path(args.windows_sdk) if getattr(args,'windows_sdk',None) else root/'Windows Kits/10'
        for label,file in [('MSVC',root/f"VC/Tools/MSVC/{lock['toolchain']['msvc']}/include/vcruntime.h"),('Windows SDK',sdk/f"Include/{lock['toolchain']['windowsSdk']}/um/Windows.h")]:
            checks.append(dict(name=label,path=str(file),passed=file.is_file()))
        active_toolset=root/'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'
        if active_toolset.exists():checks.append(dict(name='active MSVC',expected=lock['toolchain']['msvc'],actual=active_toolset.read_text().strip(),passed=active_toolset.read_text().strip()==lock['toolchain']['msvc']))
    result=dict(passed=all(c['passed'] for c in checks),checks=checks)
    print(json.dumps(result,indent=2));
    if args.output: write_json(args.output,result)
    if not result['passed']: raise ValueError('Toolchain check failed; install locked versions or review a new lock.')

def repair_checkout(args):
    run=Run(args.workspace,args.lock)
    if args.repository not in ({x['path'] for x in run.lock['sources']['repositories']}|{'tools/depot_tools'}):raise ValueError('Repository not in lock')
    label='checkout-'+args.repository
    history=[s for s in run.state['steps'] if s['label']==label and not s.get('retired')]
    failures=[s for s in run.state['steps'] if s['label'] in (label,'clone-'+args.repository) and not s.get('retired') and s.get('exitCode') not in (None,0)]
    if run.state['status']!='failed' or not failures or any(s.get('exitCode')==0 for s in history):
        raise ValueError('Only a stopped, failed INITIAL clone/checkout can be quarantined')
    repo=contained(run.root,args.repository)
    if not repo.exists():
        print('No partial directory remains; rerun prepare --resume');return
    backup=contained(run.root,'failed-checkouts/'+args.repository.replace('/','_')+'-'+str(time.time_ns()))
    backup.parent.mkdir(parents=True,exist_ok=True)
    # Both absolute paths were verified inside this tool-owned workspace. Keep all files.
    repo.rename(backup)
    for step in run.state['steps']:
        if str(repo) in step.get('command',[]):step['retired']=True
    run.state.setdefault('quarantinedCheckouts',[]).append(dict(repository=args.repository,backup=str(backup.relative_to(run.root))))
    run.save();print(f'PRESERVED {backup}; rerun prepare --resume')

def build(args):
    run=Run(args.workspace,args.lock)
    try:
        if run.state['status'] not in ('prepared','building','built','failed'): raise ValueError('Workspace not prepared')
        if not (run.root/'source-verification.json').is_file(): raise ValueError('Source verification required before building')
        run.state['status']='building';run.save()
        verify_trees(run)
        src=run.root/'src';depot=run.root/'tools/depot_tools'
        toolchain=Path(args.windows_toolchain).resolve() if args.windows_toolchain else src/'third_party/depot_tools/win_toolchain/vs_files'/run.lock['toolchain']['windowsToolchainBundle']
        doctor(argparse.Namespace(lock=args.lock,windows_toolchain=toolchain,windows_sdk=args.windows_sdk,output=run.root/'toolchain-verification.json'))
        python=build_environment(run,depot,toolchain,args.windows_sdk)
        clang=(src/'third_party/llvm-build/Release+Asserts/cr_build_revision').read_text().strip()
        if clang!=run.lock['toolchain']['clangRevision']: raise ValueError(f'Clang mismatch: {clang}')
        rust=(src/'third_party/rust-toolchain/VERSION').read_text().strip()
        if rust!=run.lock['toolchain']['rustVersion']: raise ValueError(f'Rust mismatch: {rust}')
        run.command('generate-build-inputs',[python,KERNEL/'scripts/prepare-build-inputs.py',run.root])
        lastchange=src/'build/util/lastchange.py'
        for label,options in [
            ('lastchange',['-o','src/build/util/LASTCHANGE']),
            ('gpu-version',['-m','GPU_LISTS_VERSION','--revision-id-only','--header','src/gpu/config/gpu_lists_version.h']),
            ('skia-version',['-m','SKIA_COMMIT_HASH','-s','src/third_party/skia','--header','src/skia/ext/skia_commit_hash.h']),
            ('dawn-version',['-m','DAWN_COMMIT_HASH','-s','src/third_party/dawn','--revision','src/gpu/webgpu/DAWN_VERSION','--header','src/gpu/webgpu/dawn_commit_hash.h'])]:
            run.command(label,[python,lastchange,*options])
        out=src/'out'/run.lock['build']['outDir'];out.mkdir(parents=True,exist_ok=True)
        gn_args=list(run.lock['build']['gnArgs'])
        (out/'args.gn').write_text('\n'.join(gn_args)+'\n',encoding='utf8')
        run.command('gn-gen',[src/'buildtools/win/gn.exe','gen',out,'--script-executable='+str(python)],cwd=src)
        run.command('compile-distribution',[src/'third_party/ninja/ninja.exe','-C',out,'-j',str(args.jobs),run.lock['build']['target']],cwd=src)
        run.state.update(status='built',output=str(out.relative_to(run.root)),distSha256=sha(out/'dist.zip'));run.save()
        print(f'BUILT {out}',flush=True)
    except BaseException as error:
        run.state.update(status='failed',error=str(error));run.save();raise

def probe_runtime(executable, expected):
    # A fresh main process verifies actual compiled versions and the native API.
    with tempfile.TemporaryDirectory(prefix='fp-runtime-probe-') as folder:
        root=Path(folder); script=root/'probe.js'; result=root/'result.json'
        script.write_text("const {app,session}=require('electron');const fs=require('node:fs');"
            "app.setPath('userData',process.env.FP_PROBE_PROFILE);app.whenReady().then(()=>{"
            "fs.writeFileSync(process.env.FP_PROBE_RESULT,JSON.stringify({electron:process.versions.electron,"
            "chromium:process.versions.chrome,node:process.versions.node,fpkernel:process.versions.fpkernel,"
            "platform:process.platform,arch:process.arch,hasFingerprintApi:typeof session.defaultSession.setFingerprintConfig==='function'}));"
            "app.exit(0);}).catch(()=>app.exit(1));",encoding='utf8')
        env=clean_env();env.update(FP_PROBE_PROFILE=str(root/'profile'),FP_PROBE_RESULT=str(result))
        proc=subprocess.Popen([str(executable),str(script)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        try: code=proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True)
            else:proc.kill()
            proc.wait();raise ValueError('Runtime version probe timed out')
        if code or not result.exists():raise ValueError('Runtime version probe failed')
        actual=json.loads(result.read_text(encoding='utf8'))
        if any(actual.get(k)!=v for k,v in expected.items()) or not actual['hasFingerprintApi']:
            raise ValueError(f'Compiled runtime does not match lock: {actual}')
        return actual

def managed_build_provenance(workspace, build_dir, lock_file, lock):
    state_file=Path(workspace)/'.fp-build-state.json'
    if not state_file.exists():return False
    state=json.loads(state_file.read_text(encoding='utf8'))
    if state.get('lockSha256')!=sha(lock_file) or state.get('status')!='built':
        raise ValueError('Managed build is incomplete or has a different lock')
    output_path=state.get('output')
    if not isinstance(output_path,str) or contained(workspace,output_path.replace('\\','/'))!=Path(build_dir).resolve():
        raise ValueError('Package directory is not the recorded successful build output')
    if (Path(build_dir)/'args.gn').read_text(encoding='utf8').splitlines()!=lock['build']['gnArgs']:
        raise ValueError('GN arguments changed after the locked build')
    if state.get('distSha256')!=sha(Path(build_dir)/'dist.zip'):
        raise ValueError('Official distribution changed after the recorded build')
    return True

def verify_distribution_members(distribution, records):
    with zipfile.ZipFile(distribution) as z:
        if len(z.namelist())!=len(records) or set(z.namelist())!={record['path'] for record in records}:
            raise ValueError('Runtime dependencies differ from the recorded official distribution')
        for record in records:
            with z.open(record['path']) as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if z.getinfo(record['path']).file_size!=record['size'] or digest!=record['sha256']:
                raise ValueError(f'Runtime file changed after build: {record["path"]}')

def package(args):
    lock=read_lock(args.lock);build_dir=Path(args.build_dir).resolve();src=build_dir.parent.parent
    dest=Path(args.output).resolve(); dest.mkdir(parents=True,exist_ok=True)
    version=lock['runtime'];name=f"fp-electron-{version['electron']}-fp{version['fpkernel']}-{version['platform']}-{version['arch']}-{lock['build']['profile']}"
    for relative in ('src','src/electron'):
        expected=next(x for x in lock['sources']['repositories'] if x['path']==relative)['expectedTree']
        repo=src if relative=='src' else src/'electron'
        if git(repo,'rev-parse','HEAD^{tree}')!=expected or git(repo,'status','--porcelain','--untracked-files=no','--ignore-submodules=all'):
            raise ValueError(f'Source does not match release lock: {relative}')
    archive=dest/(name+'.zip')
    if archive.exists(): raise ValueError(f'Artifact already exists: {archive}')
    managed=managed_build_provenance(src.parent,build_dir,args.lock,lock)
    runtime_probe=probe_runtime(build_dir/'electron.exe',version)
    deps=build_dir/'gen.runtime/electron/electron_dist_zip/electron_dist_zip.runtime_deps'
    spec=importlib.util.spec_from_file_location('electron_zip',src/'electron/build/zip.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    members={}
    for line in deps.read_text().splitlines():
        if module.skip_path(line,'dist.zip',version['arch']): continue
        rel=PurePosixPath(line).as_posix().removeprefix('./'); file=contained(build_dir,rel)
        if not file.exists(): raise ValueError(f'Missing runtime dependency: {rel}; build electron:electron_dist_zip first')
        if file.is_dir():
            for p in file.rglob('*'):
                if p.is_file(): members[p.relative_to(build_dir).as_posix()]=p
        else: members[rel]=file
    if not all(x in members for x in ['electron.exe','LICENSE','LICENSES.chromium.html','version']): raise ValueError('Distribution lacks executable/version/licenses')
    manifest=dict(schemaVersion=1,product='FP Electron',runtime=version,profile=lock['build']['profile'],lockSha256=sha(args.lock),
                  electronSourceTree=git(src/'electron','rev-parse','HEAD^{tree}'),chromiumSourceTree=git(src,'rev-parse','HEAD^{tree}'),
                  files=[dict(path=n,size=p.stat().st_size,sha256=sha(p)) for n,p in sorted(members.items())],
                  runtimeProbe=runtime_probe,provenance='Existing build directory; see validation report for rebuild and test status.')
    if managed:
        verify_distribution_members(build_dir/'dist.zip',manifest['files'])
        manifest['provenance']='Built by locked pipeline in an independent workspace; tool downloads may use a local cache.'
    temp=archive.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for n,p in sorted(members.items()):z.write(p,n)
        z.writestr('runtime-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
        z.writestr('build-lock.json',Path(args.lock).read_bytes())
    temp.replace(archive)
    digest=sha(archive)
    (dest/(archive.name+'.sha256')).write_text(digest+'  '+archive.name+'\n',encoding='ascii')
    write_json(dest/(name+'.manifest.json'),manifest)
    print(f'PACKAGED {archive}\nSHA256 {digest}',flush=True)

def private_source_file(name):
    name=name.lower()
    return Path(name).suffix in ('.pem','.key','.pfx','.p12','.pyc') or name.startswith('.env') or name in ('.fp-local.json','.npmrc')

def acceptance_source_sha(root=PROJECT):
    root=Path(root);files=[]
    for name in ('fp-demo','fp-sdk','scripts','fp-kernel/tests'):
        for folder,dirs,names in os.walk(root/name):
            dirs[:]=[d for d in dirs if d not in ('.git','node_modules','test-results','exports','__pycache__')]
            files.extend(Path(folder)/name for name in names if not private_source_file(name))
    files.extend(root/'fp-kernel/scripts'/name for name in ('run-acceptance.py','paths.py'))
    digest=hashlib.sha256()
    for file in sorted(files):digest.update((file.relative_to(root).as_posix()+'\0'+sha(file)+'\n').encode('utf8'))
    return digest.hexdigest()

def validate_release(args):
    root=Path(args.workspace).resolve()
    if root.exists() and any(root.iterdir()):raise ValueError('Validation workspace must be new or empty')
    root.mkdir(parents=True,exist_ok=True)
    verify_package(argparse.Namespace(archive=args.archive,extract=root/'runtime'))
    def ignored(folder,names):
        excluded={'.git','node_modules','test-results','exports','__pycache__','dist','.build','.fp-local.json'}
        if Path(folder).resolve()==PROJECT:excluded.update({'runtime','profiles'})
        return (set(names)&excluded)|{name for name in names if private_source_file(name)}
    shutil.copytree(PROJECT,root/'app',ignore=ignored)
    env=clean_env();env['FP_DEMO_ELECTRON']=str(root/'runtime/electron.exe')
    scripts=[['python',root/'app/fp-kernel/scripts/run-acceptance.py'],['node',root/'app/fp-demo/tests/run-acceptance.js'],['node',root/'app/fp-demo/tests/run-tester.js'],['node',root/'app/fp-sdk/tests/run.js']]
    report=dict(archive=str(Path(args.archive).resolve()),archiveSha256=sha(args.archive),acceptanceSourceSha256=acceptance_source_sha(root/'app'),workspace=str(root),checks=[],passed=False)
    report_file=Path(str(Path(args.archive).resolve())+'.validation.json')
    for index,command in enumerate(scripts):
        log=root/f'validation-{index}.log';print(f'VALIDATE {command[-1]}',flush=True)
        with log.open('wb') as stream:
            proc=subprocess.run([str(x) for x in command],env=env,cwd=root/'app',stdout=stream,stderr=subprocess.STDOUT)
        report['checks'].append(dict(command=[str(x) for x in command],exitCode=proc.returncode,log=str(log)))
        write_json(report_file,report)
        if proc.returncode:raise RuntimeError(f'Relocated runtime validation failed; {log}')
    report['passed']=True;write_json(report_file,report);print(f'VALIDATED {report_file}')

def export_snapshot(args):
    source=Path(args.source).resolve();dest=Path(args.output).resolve()
    if dest.exists() and any(dest.iterdir()):raise ValueError('Export destination must be new or empty')
    if dest.is_relative_to(source) or source.is_relative_to(dest):raise ValueError('Export must be outside source tree')
    dest.mkdir(parents=True,exist_ok=True)
    lock=read_lock(args.lock)
    results=[]
    for name,repo,base,extra in [('electron',source/'electron',args.electron_base or lock['sources']['electron']['commit'],['--','.',':(exclude)patches']),('chromium',source,args.chromium_base or lock['verification']['chromiumFpBase'],[])]:
        if git(repo,'status','--porcelain','--untracked-files=no','--ignore-submodules=all'):raise ValueError(f'Commit tracked edits before exporting {name}')
        base=git(repo,'rev-parse',base+'^{commit}')
        patch=subprocess.check_output(['git','-C',str(repo),'diff','--binary','--full-index','--no-ext-diff',base,'HEAD',*extra])
        if not patch:raise ValueError(f'No changes for {name}')
        file=dest/(name+'.patch');file.write_bytes(patch)
        results.append(dict(name=name,base=base,head=git(repo,'rev-parse','HEAD'),path=file.name,sha256=sha(file)))
    write_json(dest/'export.json',dict(status='review-required',patches=results,note='Snapshots only; existing ordered patches and lock were not replaced.'))

def verify_package(args):
    archive=Path(args.archive).resolve();expected=Path(str(archive)+'.sha256').read_text().split()[0]
    if sha(archive)!=expected:raise ValueError('Archive SHA256 mismatch')
    with zipfile.ZipFile(archive) as z:
        if len(z.namelist())!=len(set(z.namelist())):raise ValueError('Duplicate ZIP members')
        manifest=json.loads(z.read('runtime-manifest.json'));records=manifest['files']
        allowed={r['path'] for r in records}|{'runtime-manifest.json','build-lock.json'}
        if set(z.namelist())!=allowed:raise ValueError('Unexpected or missing ZIP member')
        for record in records:
            contained(Path(tempfile.gettempdir())/'fp-zip-check',record['path'])
            data=z.read(record['path'])
            if len(data)!=record['size'] or hashlib.sha256(data).hexdigest()!=record['sha256']:raise ValueError(f'File checksum mismatch: {record["path"]}')
        if hashlib.sha256(z.read('build-lock.json')).hexdigest()!=manifest['lockSha256']:raise ValueError('Embedded lock mismatch')
        if args.extract:
            target=Path(args.extract).resolve()
            if target.exists() and any(target.iterdir()):raise ValueError('Extraction directory must be empty')
            target.mkdir(parents=True,exist_ok=True);z.extractall(target)
    print(f'VERIFIED {len(records)} files: {archive}')
    return manifest

def validation_gate(archive):
    report=json.loads(Path(str(archive)+'.validation.json').read_text(encoding='utf8'))
    if not report.get('passed') or report.get('archiveSha256')!=sha(archive) or len(report.get('checks',[]))!=4 or any(x.get('exitCode')!=0 for x in report['checks']):
        raise ValueError('All four acceptance suites must pass against this exact archive')
    return report

def install_runtime(args):
    archive=Path(args.archive).resolve()
    manifest=verify_package(argparse.Namespace(archive=archive,extract=None));validation_gate(archive)
    project=Path(args.project).resolve();runtime=project/'runtime';runtime.mkdir(parents=True,exist_ok=True)
    dest=runtime/(archive.stem+'-'+sha(archive)[:12])
    # Never overwrite a runtime that an already-open application may be using.
    verify_package(argparse.Namespace(archive=archive,extract=dest))
    probe_runtime(dest/'electron.exe',manifest['runtime'])
    current=runtime/'current.json';old=json.loads(current.read_text(encoding='utf8')) if current.exists() else None
    if old:write_json(runtime/'previous.json',old)
    write_json(current,dict(executable=(dest/'electron.exe').relative_to(project).as_posix(),archiveSha256=sha(archive),runtime=manifest['runtime']))
    print(f'ACTIVATED {current}; restart the app to use this runtime')

def rollback_runtime(args):
    project=Path(args.project).resolve();runtime=project/'runtime'
    previous=json.loads((runtime/'previous.json').read_text(encoding='utf8'))
    executable=contained(project,previous['executable'])
    manifest_file=executable.parent/'runtime-manifest.json'
    if not manifest_file.is_file():raise ValueError('Previous runtime manifest is missing')
    manifest=json.loads(manifest_file.read_text(encoding='utf8'))
    for record in manifest['files']:
        file=contained(executable.parent,record['path'])
        if not file.is_file() or file.stat().st_size!=record['size'] or sha(file)!=record['sha256']:
            raise ValueError(f'Previous runtime checksum mismatch: {record["path"]}')
    probe_runtime(executable,previous['runtime'])
    current=runtime/'current.json';old=json.loads(current.read_text(encoding='utf8'))
    write_json(current,previous);write_json(runtime/'previous.json',old)
    print('ROLLED BACK runtime selection; restart the app. Account data was not modified.')

def release_set(args):
    archive=Path(args.archive).resolve();manifest=verify_package(argparse.Namespace(archive=archive,extract=None));report=validation_gate(archive)
    if manifest['lockSha256']!=sha(args.lock):raise ValueError('Release archive uses a different lock')
    if report.get('acceptanceSourceSha256')!=acceptance_source_sha():raise ValueError('Application or acceptance sources changed; rerun validate-release')
    dest=Path(args.output).resolve()
    if any(dest.is_relative_to(PROJECT/name) for name in ('fp-demo','fp-sdk','fp-kernel','scripts','docs')):
        raise ValueError('Release output must be outside source folders; use the project-level dist directory')
    if dest.exists() and any(dest.iterdir()):raise ValueError('Release output must be new or empty')
    dest.mkdir(parents=True,exist_ok=True)
    for file in [archive,Path(str(archive)+'.sha256'),Path(str(archive)+'.validation.json')]:shutil.copy2(file,dest/file.name)
    write_json(dest/'runtime-manifest.json',manifest)
    # Explicit source allowlist avoids packaging profiles, local paths and large build caches.
    roots=['fp-demo','fp-sdk','fp-kernel','scripts','docs']
    excluded={'.git','node_modules','test-results','exports','__pycache__','dist','.build'}
    source=dest/f"fp-lab-source-{manifest['runtime']['electron']}-fp{manifest['runtime']['fpkernel']}.zip"
    files=[]
    for name in roots:
        for folder,dirs,names in os.walk(PROJECT/name):
            dirs[:]=[d for d in dirs if d not in excluded]
            for n in names:
                p=Path(folder)/n
                if p.suffix.lower() in ('.pdb','.obj') or private_source_file(n):continue
                files.append(p)
    files += [p for p in PROJECT.iterdir() if p.is_file() and (p.name in ('README.md','.gitignore','.gitattributes') or p.suffix=='.cmd')]
    with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(files):z.write(p,p.relative_to(PROJECT).as_posix())
    source_records=[]
    with zipfile.ZipFile(source) as z:
        for name in z.namelist():
            data=z.read(name);digest=hashlib.sha256(data).hexdigest()
            if digest!=sha(contained(PROJECT,name)):raise ValueError(f'Source changed while packaging: {name}')
            source_records.append(dict(path=name,size=len(data),sha256=digest))
    write_json(dest/'source-manifest.json',dict(schemaVersion=1,runtime=manifest['runtime'],archive=source.name,
        archiveSha256=sha(source),acceptanceSourceSha256=report['acceptanceSourceSha256'],files=source_records))
    sums=''.join(sha(p)+'  '+p.name+'\n' for p in sorted(dest.iterdir()) if p.is_file())
    (dest/'SHA256SUMS').write_text(sums,encoding='utf8')
    print(f'RELEASE SET {dest}; publication is a separate explicit action')

def upgrade_plan(args):
    # Resolve the requested tag, without changing the production lock, VERSION or source.
    lock=read_lock(args.lock)
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[\w.-]+)?',args.to):raise ValueError('Expected an explicit Electron version tag')
    refs=output(['git','ls-remote',lock['sources']['electron']['url'],'refs/tags/'+args.to,'refs/tags/'+args.to+'^{}']).splitlines()
    if not refs:raise ValueError('Upstream tag does not exist')
    commit=refs[-1].split()[0]
    dest=Path(args.output).resolve()
    if dest.exists():raise ValueError('Plan output exists; choose a new file')
    write_json(dest,dict(schemaVersion=1,status='needs-adaptation',fromLockSha256=sha(args.lock),toTag=args.to,toCommit=commit,
        steps=['Prepare a NEW workspace at this upstream commit','Apply ordered FP patches; stop on first conflict','Refresh DEPS/toolchain locks and tree expectations after reviewing changes','Build and run kernel, demo and SDK acceptance','Package and verify checksums; promote lock/VERSION only after review'],
        note='This is a plan, not an approved lock. Existing runtime, branches and VERSION remain unchanged.'))
    print(f'UPGRADE PLAN {dest}')

def capture_lock(args):
    # Only creates a candidate. Versions/toolchain and ordered patch names come
    # from the maintainer's reviewed template; bases come from Electron's refs,
    # never .gclient_previous_sync_commits (which can contain patched commits).
    dest=Path(args.output).resolve();workspace=Path(args.workspace).resolve()
    if dest.exists() or dest.is_relative_to(workspace):raise ValueError('Candidate lock must be a new file outside the source workspace')
    lock=json.loads(Path(args.lock).read_text(encoding='utf8'))
    entries=ast.literal_eval((workspace/'.gclient_entries').read_text().split('=',1)[1])
    config=json.loads((workspace/'src/electron/patches/config.json').read_text())
    patched={item['repo'] for item in config}
    repositories=[]
    for relative,url in sorted(entries.items(),key=lambda pair:(pair[0].count('/'),pair[0])):
        if ':' in relative:continue  # gclient CIPD package entries, pinned by DEPS.
        repo=contained(workspace,relative)
        if not (repo/'.git').exists():continue
        if not isinstance(url,str):raise ValueError(f'Unsupported Git entry: {relative}')
        if git(repo,'status','--porcelain','--untracked-files=no','--ignore-submodules=all'):raise ValueError(f'Uncommitted source: {relative}')
        base=args.electron_base if relative=='src/electron' else 'refs/patches/upstream-head' if relative in patched else 'HEAD'
        commit=git(repo,'rev-parse',base+'^{commit}')
        git(repo,'merge-base','--is-ancestor',commit,'HEAD')
        repositories.append(dict(path=relative,url=url.rsplit('@',1)[0],commit=commit,expectedTree=git(repo,'rev-parse','HEAD^{tree}')))
    if not {'src','src/electron'}.issubset({r['path'] for r in repositories}):raise ValueError('Chromium/Electron entries missing')
    lock['sources']['repositories']=repositories
    lock['sources']['electron']['commit']=next(r['commit'] for r in repositories if r['path']=='src/electron')
    lock['sources']['depotTools']['commit']=git(args.depot_tools,'rev-parse','HEAD')
    for group in lock['patches'].values():
        for patch in group:patch['sha256']=sha(contained(KERNEL,patch['path']))
    lock['verification'].update(chromiumFpBase=git(workspace/'src','rev-parse',args.chromium_fp_base+'^{commit}'),p2Base=git(workspace/'src','rev-parse',args.chromium_p2_base+'^{commit}'))
    write_json(dest,lock)
    print(f'CANDIDATE LOCK {dest}; review versions/toolchain/patch diff, then independently prepare, build and validate before promotion')

def status(args):
    root=Path(args.workspace).resolve();state=json.loads((root/'.fp-build-state.json').read_text(encoding='utf8'))
    result={key:state.get(key) for key in ('status','lockSha256','sourceVerification','output','distSha256')}
    if state.get('steps'):
        step=state['steps'][-1];result['lastStep']=step
        log=contained(root,step['log'].replace('\\','/'))
        if log.exists():
            with log.open('rb') as stream:
                stream.seek(max(0,log.stat().st_size-6000));tail=stream.read().decode('utf8',errors='replace')
            counts=re.findall(r'\[(\d+)/(\d+)\]',tail)
            if counts:result['currentNinjaInvocation']=dict(completed=int(counts[-1][0]),total=int(counts[-1][1]))
            result['logModifiedAt']=log.stat().st_mtime
            result['logTail']=tail[-1400:]
    print(json.dumps(result,ensure_ascii=False,indent=2))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--lock',default=str(DEFAULT_LOCK));sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('doctor');p.add_argument('--windows-toolchain');p.add_argument('--windows-sdk');p.add_argument('--output');p.set_defaults(func=doctor)
    p=sub.add_parser('status');p.add_argument('--workspace',required=True);p.set_defaults(func=status)
    p=sub.add_parser('repair-checkout');p.add_argument('--workspace',required=True);p.add_argument('--repository',required=True);p.set_defaults(func=repair_checkout)
    p=sub.add_parser('prepare');p.add_argument('--workspace',required=True);p.add_argument('--reference');p.add_argument('--depot-tools');p.add_argument('--windows-toolchain');p.add_argument('--windows-sdk');p.add_argument('--resume',action='store_true');p.set_defaults(func=prepare)
    p=sub.add_parser('build');p.add_argument('--workspace',required=True);p.add_argument('--windows-toolchain');p.add_argument('--windows-sdk');p.add_argument('--jobs',type=int,default=12);p.set_defaults(func=build)
    p=sub.add_parser('package');p.add_argument('--build-dir',required=True);p.add_argument('--output',default=str(PROJECT/'dist/runtime'));p.set_defaults(func=package)
    p=sub.add_parser('verify-package');p.add_argument('--archive',required=True);p.add_argument('--extract');p.set_defaults(func=verify_package)
    p=sub.add_parser('validate-release');p.add_argument('--archive',required=True);p.add_argument('--workspace',required=True);p.set_defaults(func=validate_release)
    p=sub.add_parser('install-runtime');p.add_argument('--archive',required=True);p.add_argument('--project',default=str(PROJECT));p.set_defaults(func=install_runtime)
    p=sub.add_parser('rollback-runtime');p.add_argument('--project',default=str(PROJECT));p.set_defaults(func=rollback_runtime)
    p=sub.add_parser('release-set');p.add_argument('--archive',required=True);p.add_argument('--output',required=True);p.set_defaults(func=release_set)
    p=sub.add_parser('export');p.add_argument('--source',required=True);p.add_argument('--electron-base');p.add_argument('--chromium-base');p.add_argument('--output',required=True);p.set_defaults(func=export_snapshot)
    p=sub.add_parser('upgrade-plan');p.add_argument('--to',required=True);p.add_argument('--output',required=True);p.set_defaults(func=upgrade_plan)
    p=sub.add_parser('capture-lock');p.add_argument('--workspace',required=True);p.add_argument('--depot-tools',required=True);p.add_argument('--electron-base',required=True);p.add_argument('--chromium-fp-base',required=True);p.add_argument('--chromium-p2-base',required=True);p.add_argument('--output',required=True);p.set_defaults(func=capture_lock)
    args=parser.parse_args()
    try:args.func(args);return 0
    except (Exception,KeyboardInterrupt) as error:print(f'FAILED: {brief(error)}',file=sys.stderr,flush=True);return 1

if __name__=='__main__':raise SystemExit(main())
