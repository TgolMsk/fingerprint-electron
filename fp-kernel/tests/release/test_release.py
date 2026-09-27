"""Failure-path tests for the build/release pipeline; no network or real source edits."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[2]/'scripts/release.py'
spec=importlib.util.spec_from_file_location('release',SCRIPT)
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='fp-release-test-');self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def fake_lock(self):
        p=self.root/'lock.json';release.write_json(p,{'schemaVersion':1,'patches':{}});return p
    def test_refuses_existing_workspace(self):
        root=self.root/'source';root.mkdir();(root/'user.txt').write_text('keep')
        with self.assertRaises(ValueError):release.Run(root,self.fake_lock(),create=True)
        self.assertEqual((root/'user.txt').read_text(),'keep')
    def test_bad_patch_checksum_stops_before_workspace_created(self):
        p=self.fake_lock();release.write_json(p,{'schemaVersion':1,'patches':{'electron':[{'path':'patches/electron/fp_00_config.patch','sha256':'0'*64}]}})
        with self.assertRaises(ValueError):release.Run(self.root/'source',p,create=True)
        self.assertFalse((self.root/'source').exists())
    def test_failed_command_records_nonzero_and_stops(self):
        run=release.Run(self.root/'source',self.fake_lock(),create=True)
        with self.assertRaises(RuntimeError):run.command('expected-failure',[sys.executable,'-c','import sys;sys.exit(7)'])
        state=json.loads(run.state_file.read_text());self.assertEqual(state['status'],'failed');self.assertEqual(state['steps'][0]['exitCode'],7)
    def test_resume_requires_same_lock(self):
        lock=self.fake_lock();run=release.Run(self.root/'source',lock,create=True)
        release.write_json(lock,{'schemaVersion':1,'patches':{},'changed':True})
        with self.assertRaises(ValueError):release.Run(run.root,lock,create=True,resume=True)
    def test_resume_does_not_repeat_successful_mutation(self):
        lock=self.fake_lock();run=release.Run(self.root/'source',lock,create=True)
        args=[sys.executable,'-c',"from pathlib import Path; p=Path('counter'); p.write_text(p.read_text()+'x' if p.exists() else 'x')"]
        run.command('write-once',args)
        resumed=release.Run(run.root,lock,create=True,resume=True);resumed.command('write-once',args)
        self.assertEqual((run.root/'counter').read_text(),'x')
    def test_resume_rejects_changed_recipe_for_completed_step(self):
        lock=self.fake_lock();run=release.Run(self.root/'source',lock,create=True)
        run.command('once',[sys.executable,'-c','pass'])
        resumed=release.Run(run.root,lock,create=True,resume=True)
        with self.assertRaises(ValueError):resumed.command('once',[sys.executable,'-c','raise Exception("must not run")'])
    def test_path_traversal_rejected(self):
        for relative in ('../outside','C:/outside','a\\..\\outside','/outside'):
            with self.assertRaises(ValueError):release.contained(self.root,relative)
    def make_zip(self,bad_file=False,extra=False):
        archive=self.root/'runtime.zip';lock=b'{}';payload=b'hello'
        manifest={'files':[{'path':'electron.exe','size':5,'sha256':release.hashlib.sha256(b'wrong' if bad_file else payload).hexdigest()}],'lockSha256':release.hashlib.sha256(lock).hexdigest()}
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('runtime-manifest.json',json.dumps(manifest));z.writestr('build-lock.json',lock);z.writestr('electron.exe',payload)
            if extra:z.writestr('unexpected.txt','x')
        Path(str(archive)+'.sha256').write_text(release.sha(archive)+'  runtime.zip\n')
        return archive
    def test_archive_tampering_rejected(self):
        archive=self.make_zip();archive.write_bytes(archive.read_bytes()+b'changed')
        with self.assertRaises(ValueError):release.verify_package(release.argparse.Namespace(archive=archive,extract=None))
    def test_file_tampering_rejected_even_with_recomputed_zip_checksum(self):
        with self.assertRaises(ValueError):release.verify_package(release.argparse.Namespace(archive=self.make_zip(bad_file=True),extract=None))
    def test_extra_archive_file_rejected(self):
        with self.assertRaises(ValueError):release.verify_package(release.argparse.Namespace(archive=self.make_zip(extra=True),extract=None))
    def test_valid_archive_extracts_only_into_empty_directory(self):
        archive=self.make_zip();target=self.root/'runtime'
        args=release.argparse.Namespace(archive=archive,extract=target);release.verify_package(args)
        self.assertEqual((target/'electron.exe').read_bytes(),b'hello')
        with self.assertRaises(ValueError):release.verify_package(args)
    def test_git_redirection_and_node_mode_removed(self):
        old=os.environ.get('GIT_DIR');os.environ['GIT_DIR']='bad'
        try:self.assertNotIn('GIT_DIR',release.clean_env())
        finally:
            if old is None:os.environ.pop('GIT_DIR',None)
            else:os.environ['GIT_DIR']=old
    def test_cached_readonly_payload_is_not_overwritten(self):
        source=self.root/'source';target=self.root/'target'
        source.write_bytes(b'cached');target.write_bytes(b'cached')
        with patch.object(release.shutil,'copy2',side_effect=AssertionError('must not overwrite')):
            release.copy_cached_file(source,target)
        target.write_bytes(b'changed')
        with self.assertRaises(ValueError):release.copy_cached_file(source,target)
    def test_prepared_cache_can_seed_a_second_clean_workspace(self):
        reference=self.root/'reference';intermediate=self.root/'first';destination=self.root/'second'
        asset='src/test_data/fixture';file=reference/asset/'BUILD.gn';file.parent.mkdir(parents=True);file.write_text('pinned asset')
        (reference/'.gclient_entries').write_text("entries = {'src/test_data/fixture:cipd/package':'pinned-package'}\n")
        copied=release.seed_assets(reference,intermediate)
        release.write_gclient_entries(intermediate,[],reference,copied)
        release.seed_assets(intermediate,destination)
        self.assertEqual((destination/asset/'BUILD.gn').read_text(),'pinned asset')
    def test_validation_gate_requires_exact_archive_and_all_suites(self):
        archive=self.make_zip();report=Path(str(archive)+'.validation.json')
        good={'passed':True,'archiveSha256':release.sha(archive),'checks':[{'exitCode':0}]*4}
        release.write_json(report,good);release.validation_gate(archive)
        for bad in [{**good,'archiveSha256':'0'*64},{**good,'passed':False},{**good,'checks':[{'exitCode':0}]},{**good,'checks':[{'exitCode':1}]*4}]:
            release.write_json(report,bad)
            with self.assertRaises(ValueError):release.validation_gate(archive)
    def test_package_provenance_requires_exact_build_output_flags_and_distribution(self):
        root=self.root/'workspace';out=root/'src/out/FPTesting';out.mkdir(parents=True)
        lock_file=self.fake_lock();lock={'build':{'gnArgs':['symbol_level=0']}}
        (out/'args.gn').write_text('symbol_level=0\n');(out/'dist.zip').write_bytes(b'original distribution')
        state={'status':'built','lockSha256':release.sha(lock_file),'output':'src\\out\\FPTesting','distSha256':release.sha(out/'dist.zip')}
        release.write_json(root/'.fp-build-state.json',state)
        self.assertTrue(release.managed_build_provenance(root,out,lock_file,lock))
        with self.assertRaises(ValueError):release.managed_build_provenance(root,out.parent/'Other',lock_file,lock)
        (out/'args.gn').write_text('symbol_level=2\n')
        with self.assertRaises(ValueError):release.managed_build_provenance(root,out,lock_file,lock)
        (out/'args.gn').write_text('symbol_level=0\n');(out/'dist.zip').write_bytes(b'changed distribution')
        with self.assertRaises(ValueError):release.managed_build_provenance(root,out,lock_file,lock)
    def test_replaced_loose_runtime_cannot_claim_recorded_distribution(self):
        archive=self.root/'dist.zip'
        with zipfile.ZipFile(archive,'w') as z:z.writestr('electron.exe',b'hello')
        records=[{'path':'electron.exe','size':5,'sha256':release.hashlib.sha256(b'hello').hexdigest()}]
        release.verify_distribution_members(archive,records)
        records[0]['sha256']=release.hashlib.sha256(b'wrong').hexdigest()
        with self.assertRaises(ValueError):release.verify_distribution_members(archive,records)
    def test_install_failure_preserves_current_runtime(self):
        project=self.root/'app';current=project/'runtime/current.json'
        release.write_json(current,{'executable':'runtime/old/electron.exe'})
        before=current.read_bytes();archive=self.make_zip()
        with patch.object(release,'validation_gate'),patch.object(release,'verify_package',return_value={'runtime':{}}),patch.object(release,'probe_runtime',side_effect=ValueError('wrong binary')):
            with self.assertRaises(ValueError):release.install_runtime(release.argparse.Namespace(archive=archive,project=project))
        self.assertEqual(current.read_bytes(),before)
    def test_rollback_failure_preserves_current_pointer(self):
        project=self.root/'app';current=project/'runtime/current.json'
        release.write_json(current,{'executable':'runtime/new/electron.exe'})
        release.write_json(project/'runtime/previous.json',{'executable':'runtime/old/electron.exe','runtime':{}})
        before=current.read_bytes()
        with patch.object(release,'probe_runtime',side_effect=ValueError('missing old binary')):
            with self.assertRaises(ValueError):release.rollback_runtime(release.argparse.Namespace(project=project))
        self.assertEqual(current.read_bytes(),before)
    def test_failed_initial_checkout_quarantined_with_files_preserved(self):
        lock=self.fake_lock();release.write_json(lock,{'schemaVersion':1,'patches':{},'sources':{'repositories':[{'path':'src/dependency'}]}})
        run=release.Run(self.root/'workspace',lock,create=True);repo=run.root/'src/dependency';repo.mkdir(parents=True);(repo/'partial').write_text('keep')
        run.state['steps']=[{'label':'checkout-src/dependency','exitCode':1,'command':['git','-C',str(repo),'checkout','pinned']}];run.state['status']='failed';run.save()
        args=release.argparse.Namespace(workspace=run.root,lock=lock,repository='src/dependency');release.repair_checkout(args)
        state=json.loads(run.state_file.read_text());backup=run.root/state['quarantinedCheckouts'][0]['backup']
        self.assertEqual((backup/'partial').read_text(),'keep');self.assertTrue(state['steps'][0]['retired']);self.assertFalse(repo.exists())
    def test_repair_cannot_replace_successful_checkout(self):
        lock=self.fake_lock();release.write_json(lock,{'schemaVersion':1,'patches':{},'sources':{'repositories':[{'path':'src/dependency'}]}})
        run=release.Run(self.root/'workspace',lock,create=True);run.state['steps']=[{'label':'checkout-src/dependency','exitCode':0}];run.state['status']='failed';run.save()
        with self.assertRaises(ValueError):release.repair_checkout(release.argparse.Namespace(workspace=run.root,lock=lock,repository='src/dependency'))
    def test_partial_clone_can_be_preserved_before_first_checkout(self):
        lock=self.fake_lock();release.write_json(lock,{'schemaVersion':1,'patches':{},'sources':{'repositories':[{'path':'src/dependency'}]}})
        for index,relative in enumerate(('src/dependency','tools/depot_tools')):
            run=release.Run(self.root/f'workspace-{index}',lock,create=True);repo=run.root/relative;repo.mkdir(parents=True);(repo/'partial').write_text('keep')
            run.state.update(status='failed',steps=[{'label':'clone-'+relative,'exitCode':128,'command':['git','clone','remote',str(repo)]}]);run.save()
            release.repair_checkout(release.argparse.Namespace(workspace=run.root,lock=lock,repository=relative))
            state=json.loads(run.state_file.read_text());self.assertEqual((run.root/state['quarantinedCheckouts'][0]['backup']/'partial').read_text(),'keep')
    def test_repair_refuses_running_preparation(self):
        lock=self.fake_lock();release.write_json(lock,{'schemaVersion':1,'patches':{},'sources':{'repositories':[{'path':'src/dependency'}]}})
        run=release.Run(self.root/'workspace',lock,create=True);repo=run.root/'src/dependency';repo.mkdir(parents=True);(repo/'keep').write_text('active')
        run.state['steps']=[{'label':'clone-src/dependency','exitCode':128,'command':['git','clone','remote',str(repo)]}];run.save()
        with self.assertRaises(ValueError):release.repair_checkout(release.argparse.Namespace(workspace=run.root,lock=lock,repository='src/dependency'))
        self.assertEqual((repo/'keep').read_text(),'active')
    def test_source_release_preserves_profiles_but_excludes_local_secrets_and_caches(self):
        project=self.root/'project';project.mkdir();sentinel='synthetic-local-secret'
        contents={'fp-sdk/profiles/device.json':'{}','scripts/runtime-path.js':'module.exports={};',
                  'fp-kernel/tests/consistency/key.pem':sentinel,'fp-kernel/tests/consistency/cert.pem':sentinel,
                  'fp-demo/.env':sentinel,'fp-sdk/.npmrc':sentinel,'.fp-local.json':sentinel,
                  'fp-demo/node_modules/cache.txt':sentinel,'fp-sdk/test-results/state.json':sentinel}
        for relative,data in contents.items():
            p=project/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data)
        archive=self.make_zip();Path(str(archive)+'.validation.json').write_text('{}');lock=self.fake_lock()
        manifest={'lockSha256':release.sha(lock),'runtime':{'electron':'1.0.0','fpkernel':'0.1.0'}}
        dest=self.root/'release'
        with patch.object(release,'PROJECT',project),patch.object(release,'verify_package',return_value=manifest),patch.object(release,'validation_gate',return_value={'acceptanceSourceSha256':'tested'}),patch.object(release,'acceptance_source_sha',return_value='tested'):
            release.release_set(release.argparse.Namespace(archive=archive,lock=lock,output=dest))
        with zipfile.ZipFile(next(dest.glob('fp-lab-source-*.zip'))) as z:
            self.assertIn('fp-sdk/profiles/device.json',z.namelist());self.assertIn('scripts/runtime-path.js',z.namelist())
            self.assertFalse(any(sentinel.encode() in z.read(n) for n in z.namelist()))
    def test_windows_git_checkout_preserves_locked_patch_bytes(self):
        repo=self.root/'repo';repo.mkdir();clone=self.root/'clone'
        release.shutil.copy2(release.KERNEL/'.gitattributes',repo/'.gitattributes')
        patch_file=repo/'fp_test.patch';patch_file.write_bytes(b'From commit\nSubject: test\n\n+locked content\n')
        lock_file=repo/'build/lock.json';lock_file.parent.mkdir()
        release.shutil.copy2(release.DEFAULT_LOCK,lock_file)
        for args in [('init',),('config','core.autocrlf','true'),('add','.'),('-c','user.name=FP Test','-c','user.email=test@fp.invalid','-c','commit.gpgsign=false','commit','-m','fixture')]:
            subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,env=release.clean_env())
        subprocess.run(['git','-c','core.autocrlf=true','clone',str(repo),str(clone)],check=True,capture_output=True,env=release.clean_env())
        for file in (patch_file,lock_file):self.assertEqual(file.read_bytes(),(clone/file.relative_to(repo)).read_bytes())
    def test_explicit_toolchain_does_not_precreate_source_checkout(self):
        depot=self.root/'depot-cache';(depot/'bootstrap/bin').mkdir(parents=True)
        (depot/'python3_bin_reldir.txt').write_text('bootstrap/bin');(depot/'bootstrap/bin/python3.exe').write_bytes(b'fixture')
        toolchain=self.root/'toolchain'
        for name in ('sys64','sys32','sysarm64'):(toolchain/name).mkdir(parents=True)
        lock=self.fake_lock();release.write_json(lock,{'schemaVersion':1,'patches':{'electron':[],'chromium':[]},
            'toolchain':{'buildPython':'3.11.8','visualStudioYear':'2026'},
            'sources':{'depotTools':{'url':'fixture','commit':'pinned'},'repositories':[
                {'path':name,'url':'fixture','commit':'pinned'} for name in ('src','src/electron')]}})
        def clone(run,relative,*args):
            destination=run.root/relative
            self.assertFalse(destination.exists(),f'clone destination precreated: {relative}')
            destination.mkdir(parents=True)
            if relative=='src/electron':
                (destination/'patches/chromium').mkdir(parents=True);(destination/'patches/chromium/.patches').write_text('')
        workspace=self.root/'workspace'
        with patch.object(release.Run,'clone',clone),patch.object(release.Run,'command'),patch.object(release,'output',return_value='Python 3.11.8'),patch.object(release,'verify_trees'):
            release.prepare(release.argparse.Namespace(workspace=workspace,lock=lock,resume=False,reference=None,depot_tools=depot,windows_toolchain=toolchain,windows_sdk=None))
        config=json.loads((workspace/'src/build/win_toolchain.json').read_text())
        self.assertEqual(config['path'],str(toolchain));self.assertEqual(json.loads((workspace/'.fp-build-state.json').read_text())['status'],'prepared')

if __name__=='__main__':unittest.main()
