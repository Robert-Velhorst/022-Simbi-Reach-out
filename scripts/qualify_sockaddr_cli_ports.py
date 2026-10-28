"""Qualify both private parent ports with complete unchanged upstream cases."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
    raise SystemExit('Only disposable GitHub-hosted workers may execute SDK qualification.')
ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/'third_party/sockaddr-cli-ports'
P=json.loads((INPUT/'provenance.json').read_text())
assert not P['case_assertion_fixture_or_selection_changes']
WORK=Path(os.environ['RUNNER_TEMP'])/'simbi-sockaddr-cli-ports'
OUT=WORK/'evidence';OUT.mkdir(parents=True,exist_ok=False)
modules={m['label']:m for m in P['modules']}
original={};cases={};errors=[]

def run(args,name,*,data=None):
    result=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    (OUT/(name+'.log')).write_text(result.stdout,encoding='utf-8')
    (OUT/(name+'.stderr.log')).write_text(result.stderr,encoding='utf-8')
    print(result.stdout,flush=True);print(result.stderr,flush=True)
    if result.returncode:raise subprocess.CalledProcessError(result.returncode,args)
    return result.stdout

def ledger(label):
    directory=WORK/label
    paths=subprocess.check_output(['git','-C',str(directory),'ls-files','-z']).decode().split('\0')
    return {p:hashlib.sha256(os.readlink(directory/p).encode() if (directory/p).is_symlink()
        else (directory/p).read_bytes()).hexdigest() for p in paths if p}

for label,module in modules.items():
    directory=WORK/label
    run(['git','clone','--filter=blob:none','--no-checkout',module['upstream_git_url'],str(directory)],label+'-clone')
    run(['git','-C',str(directory),'checkout','--detach',module['upstream_git_commit']],label+'-checkout')
    assert subprocess.check_output(['git','-C',str(directory),'rev-parse','HEAD']).decode().strip()==module['upstream_git_commit']
    for path,digest in module['published_original_sha256'].items():
        assert hashlib.sha256((directory/path).read_bytes()).hexdigest()==digest, 'Publisher/Git mismatch: '+path
    original[label]=ledger(label)
    cases[label]={p:h for p,h in original[label].items() if p.endswith('_test.go') or p.startswith('testdata/') or '/testdata/' in p}
    assert cases[label]
    (OUT/(label+'-original-source-sha256.json')).write_text(json.dumps(original[label],indent=2)+'\n')
    for path,digest in module['overlay_sha256'].items():
        payload=(INPUT/label/'overlay'/path).read_bytes()
        assert hashlib.sha256(payload).hexdigest()==digest
        (directory/path).write_bytes(payload)
    applied=ledger(label)
    assert all(applied[p]==h for p,h in cases[label].items())
dockerfile='''FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c
RUN apk upgrade --no-cache && apk add --no-cache build-base bash iproute2
'''
run(['docker','build','--tag','simbi-parent-sdk:qualification','-'],'sdk-image',data=dockerfile)
for name in ['home','cache','modcache']:(WORK/name).mkdir()

def sdk(label,args,name,*,workspace=True,cgo='1'):
    return run(['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}',
        '--volume',f'{WORK}:/work','--workdir','/work/'+label,
        '--env','HOME=/work/home','--env','GOCACHE=/work/cache','--env','GOMODCACHE=/work/modcache',
        '--env','GOTOOLCHAIN=local','--env','GOENV=off','--env','CGO_ENABLED='+cgo,
        '--env','GOWORK='+('/work/go.work' if workspace else 'off'),
        '--env','GOPROXY=https://proxy.golang.org','--env','GOSUMDB=sum.golang.org',
        'simbi-parent-sdk:qualification',*args],name)

def attempt(label,args,name,**options):
    try:return sdk(label,args,name,**options)
    except Exception as error:
        errors.append({'step':name,'error':str(error)});return None

try:
    for label,module in modules.items():
        queries=[name+'@latest' for name in module['declaration_catalog']]
        latest=sdk(label,['go','list','-e','-m','-json',*queries],label+'-canonical-latest',workspace=False)
        decoder=json.JSONDecoder();offset=0;selected={}
        while offset<len(latest):
            if latest[offset].isspace():offset+=1;continue
            item,offset=decoder.raw_decode(latest,offset);selected[item['Path']]=item
        assert set(selected)==set(module['declaration_catalog'])
        mismatches=[name for name,record in module['declaration_catalog'].items()
            if selected[name].get('Error') or selected[name].get('Version')!=record['metadata']['Version']]
        assert not mismatches, 'Declaration candidates differ from canonical Go releases: '+str(mismatches)
        sdk(label,['go','mod','tidy'],label+'-normal-tidy',workspace=False)
        sdk(label,['go','mod','verify'],label+'-module-integrity',workspace=False)
        production=[p for p in module['actual_source_changes'] if p.endswith('.go')]
        if production:sdk(label,['gofmt','-w',*production],label+'-production-format',workspace=False)
    sdk('', ['go','work','init','./sockaddr','./cli'],'private-source-workspace',workspace=False)
    for label in modules:
        attempt(label,['go','build','./...'],label+'-complete-production-build')
    # Same original full-package tests; -json only adds machine-readable reporting.
    for label in modules:
        attempt(label,['go','test','-json','./...'],label+'-complete-original-cases')
    # Preserve the canonical CLI's separate upstream WASM build requirement.
    attempt('cli',['env','GOOS=js','GOARCH=wasm','go','build','-o','/work/evidence/cli-test.wasm','.'],
        'cli-original-wasm-build',cgo='0')
    graph=attempt('sockaddr',['go','list','-m','-json','all'],'effective-private-module-graph')
    packages=attempt('sockaddr',['go','list','-deps','./...'],'actual-sockaddr-package-graph')
    if graph is not None and packages is not None:
        assert 'github.com/hashicorp/cli' in packages.splitlines()
        assert 'dario.cat/mergo' in packages.splitlines()
        assert not any(p.startswith(('github.com/mitchellh/cli','github.com/imdario/mergo')) for p in packages.splitlines())
    (OUT/'qualification-summary.json').write_text(json.dumps({'errors':errors,'all_recorded_commands_passed':not errors,
        'upstream_case_or_selection_changes':False,'private_source_workspace_not_module_replacement':True,
        'entire_transitive_graph_and_major_path_currency_qualified':False,
        'original_crypto11_test_exception_applied':False,'application_graph_adopted':False,
        'image_provider_database_or_deployment_acceptance':False},indent=2)+'\n')
finally:
    for label,module in modules.items():
        after=ledger(label)
        assert all(after[p]==h for p,h in cases[label].items()), 'Original case/fixture changed: '+label
        allowed=set(module['actual_source_changes'])|{'go.sum'}
        assert all(original[label][p]==after[p] for p in original[label] if p not in allowed)
        (OUT/(label+'-post-source-sha256.json')).write_text(json.dumps(after,indent=2)+'\n')
        (OUT/(label+'-case-preservation.json')).write_text(json.dumps({'all_original_case_fixture_payloads_unchanged':True,
            'protected_case_fixture_files':len(cases[label]),'original_go_case_files':module['original_go_case_files']},indent=2)+'\n')
        for path in ['go.mod','go.sum']:(OUT/(label+'-'+path)).write_bytes((WORK/label/path).read_bytes())
if errors:raise SystemExit('Original upstream commands remain failed; inspect retained logs.')
