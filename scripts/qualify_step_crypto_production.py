"""Build a canonical-module parent port; never run or modify its original cases."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
    raise SystemExit('Only disposable GitHub-hosted workers may execute this qualification.')
ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/'third_party/step-crypto-production-port'
WORK=Path(os.environ['RUNNER_TEMP'])/'simbi-step-crypto-production'
OUT=WORK/'evidence'
OUT.mkdir(parents=True,exist_ok=False)
P=json.loads((INPUT/'provenance.json').read_text())
assert not P['original_cases_changed'] and not P['pending_test_import_diff_included']

def run(args,name,*,data=None):
    result=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (OUT/(name+'.log')).write_text(result.stdout,encoding='utf-8')
    print(result.stdout,flush=True)
    if result.returncode:raise subprocess.CalledProcessError(result.returncode,args)
    return result.stdout

source=WORK/'crypto'
run(['git','clone','--filter=blob:none','--no-checkout',P['upstream_git_url'],str(source)],'source-clone')
run(['git','-C',str(source),'checkout','--detach',P['upstream_git_commit']],'source-checkout')
assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD']).decode().strip()==P['upstream_git_commit']
for path,digest in P['published_original_sha256'].items():
    assert hashlib.sha256((source/path).read_bytes()).hexdigest()==digest, 'Publisher/Git mismatch: '+path

def ledger():
    paths=subprocess.check_output(['git','-C',str(source),'ls-files','-z']).decode().split('\0')
    return {p:hashlib.sha256(os.readlink(source/p).encode() if (source/p).is_symlink()
                else (source/p).read_bytes()).hexdigest() for p in paths if p}

before=ledger()
(OUT/'complete-original-git-source-sha256.json').write_text(json.dumps(before,indent=2)+'\n')
for path,digest in P['overlay_sha256'].items():
    payload=(INPUT/'overlay'/path).read_bytes()
    assert hashlib.sha256(payload).hexdigest()==digest
    (source/path).write_bytes(payload)
original_cases={p:h for p,h in before.items() if p.endswith('_test.go') or '/testdata/' in p}
applied=ledger()
assert original_cases and all(applied[p]==digest for p,digest in original_cases.items())
dockerfile='''FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c
RUN apk upgrade --no-cache && apk add --no-cache build-base pcsc-lite-dev
'''
run(['docker','build','--tag','simbi-step-crypto-sdk:qualification','-'],'native-sdk-image',data=dockerfile)
for name in ['home','cache','modcache']:(WORK/name).mkdir()

def go(args,name):
    return run(['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}',
        '--volume',f'{WORK}:/work','--workdir','/work/crypto',
        '--env','HOME=/work/home','--env','GOCACHE=/work/cache','--env','GOMODCACHE=/work/modcache',
        '--env','CGO_ENABLED=1','--env','GOTOOLCHAIN=local','--env','GOENV=off','--env','GOWORK=off',
        '--env','GOPROXY=https://proxy.golang.org','--env','GOSUMDB=sum.golang.org',
        'simbi-step-crypto-sdk:qualification','go',*args],name)

failure=None
try:
    environment=json.loads(go(['env','-json','GOVERSION','CGO_ENABLED','GOOS','GOARCH'],'actual-sdk-environment'))
    assert environment['GOVERSION']=='go1.27.3' and environment['CGO_ENABLED']=='1'
    go(['mod','download','all'],'normal-module-download')
    # Production compilation is distinct from the untouched original SDK suite.
    # No Go test command, case selector, -short flag or build tag is introduced.
    go(['build','-mod=mod','./...'],'complete-sdk-production-build')
    packages=go(['list','-mod=readonly','-deps','./...'],'actual-production-package-graph').splitlines()
    assert 'go.step.sm/crypto/kms/pkcs11' in packages
    assert P['canonical_crypto11']['module'] in packages
    assert not any(p.startswith(('github.com/ThalesGroup/crypto11','github.com/ThalesIgnite/crypto11')) for p in packages)
    module=json.loads(go(['list','-mod=readonly','-m','-json',P['canonical_crypto11']['module']],
        'actual-canonical-crypto11-module'))
    assert module['Version']==P['canonical_crypto11']['version'] and not module.get('Replace')
    go(['mod','verify'],'normal-module-integrity')
    expected_sum=P['canonical_crypto11']['module']+' '+P['canonical_crypto11']['version']+' '+P['canonical_crypto11']['publisher_module_h1']
    assert expected_sum in (source/'go.sum').read_text().splitlines(), 'Canonical publisher checksum mismatch'
    (OUT/'production-build-proof.json').write_text(json.dumps({'passed':True,
        'environment':environment,'compiled_package_count':len(packages),
        'canonical_module':module,'original_sdk_cases_executed':False,
        'real_hsm_key_provider_or_data_access':False,'whole_graph_or_image_qualified':False},indent=2)+'\n')
except Exception as error:
    failure=error
finally:
    after=ledger()
    assert all(after[p]==digest for p,digest in original_cases.items()), 'An original case/fixture changed'
    allowed=set(P['actual_source_changes'])|{'go.sum'}
    assert all(before[p]==after[p] for p in before if p not in allowed), 'Unexpected upstream source mutation'
    (OUT/'post-build-complete-source-sha256.json').write_text(json.dumps(after,indent=2)+'\n')
    (OUT/'original-case-preservation.json').write_text(json.dumps({'all_original_cases_and_testdata_unchanged':True,
        'original_case_or_testdata_files':len(original_cases),'SDK_suite_executed':False,
        'pending_test_import_patch_applied':False,'allowed_production_metadata_paths':sorted(allowed)},indent=2)+'\n')
    for path in ['go.mod','go.sum']:
        (OUT/path).write_bytes((source/path).read_bytes())
if failure:raise failure
