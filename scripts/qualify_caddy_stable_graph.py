"""Qualify normal stable-module selection and complete upstream cases on hosted workers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise SystemExit('This qualification runs only on disposable GitHub-hosted workers.')
ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ['RUNNER_TEMP']) / 'simbi-caddy-stable-graph'
OUT = WORK / 'evidence'
IMAGE = 'golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c'
UPSTREAM = '72dd0fb067f6d7826c7f79907670ba4a713bfe37'

def command(args, name, *, cwd=None, structured=False):
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE if structured else subprocess.STDOUT)
    (OUT / (name+'.log')).write_text(result.stdout, encoding='utf-8')
    print(result.stdout, flush=True)
    if structured:
        (OUT / (name+'.stderr.log')).write_text(result.stderr, encoding='utf-8')
        print(result.stderr, flush=True)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args)
    return result.stdout

def go(args, name, *, directory='edge', workspace=False, structured=False):
    return command(['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}',
        '--volume',f'{WORK}:/work','--workdir','/work/'+directory,
        '--env','HOME=/work/home','--env','GOCACHE=/work/cache','--env','GOMODCACHE=/work/modcache',
        '--env','GOTOOLCHAIN=local','--env','GOENV=off','--env','CGO_ENABLED=0',
        '--env','GOWORK='+('/work/go.work' if workspace else 'off'),
        '--env','GOPROXY=https://proxy.golang.org','--env','GOSUMDB=sum.golang.org',
        IMAGE,'go',*args],name,structured=structured)

def stream_json(text):
    decoder=json.JSONDecoder(); rows=[]; offset=0
    while offset<len(text):
        if text[offset].isspace(): offset+=1; continue
        row,offset=decoder.raw_decode(text,offset); rows.append(row)
    return rows

def catalog(item):
    module,canonical=item
    name=module['Path']
    escaped=''.join('!'+c.lower() if c.isupper() else c for c in name)
    url='https://proxy.golang.org/'+quote(escaped,safe='/!')+'/@v/list'
    with urlopen(url, timeout=60) as response:
        versions=response.read().decode().splitlines()
    final=[v for v in versions if re.fullmatch(r'v\d+\.\d+\.\d+(?:\+incompatible)?',v)]
    key=lambda v:tuple(map(int,v.split('+')[0][1:].split('.')))
    highest=max(final,key=key) if final else None
    version=canonical.get('Version')
    target=version if not canonical.get('Error') and re.fullmatch(r'v\d+\.\d+\.\d+(?:\+incompatible)?',version or '') else None
    return {'module':name,'installed':module.get('Version'),'canonical_final_target':target,
            'canonical_go_latest_query':canonical,'highest_numeric_tag_diagnostic_only':highest,
            'source':url,'tagged_final_count':len(final),
            'selection':'Go latest query, respecting retractions and module-version semantics; raw numeric maximum is not a target'}

def catalogs(modules,label):
    selected=[m for m in modules if not m.get('Main')]
    queries=[m['Path']+'@latest' for m in selected]
    latest=stream_json(go(['list','-e','-m','-json',*queries],label+'-canonical-latest',structured=True))
    by_name={m['Path']:m for m in latest}
    assert set(by_name)=={m['Path'] for m in selected}, 'Incomplete canonical module query scope'
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(catalog,[(m,by_name[m['Path']]) for m in selected]))

def source_ledger():
    paths=subprocess.check_output(['git','-C',str(WORK/'caddy'),'ls-files','-z']).decode().split('\0')
    return {p:hashlib.sha256((WORK/'caddy'/p).read_bytes()).hexdigest() for p in paths if p}

phase=sys.argv[1]
if phase=='refresh':
    OUT.mkdir(parents=True,exist_ok=False)
    for name in ['edge','home','cache','modcache']:
        (WORK/name).mkdir()
    for path in (ROOT/'edge').iterdir():
        if path.is_file(): shutil.copyfile(path,WORK/'edge'/path.name)
    command(['git','clone','--filter=blob:none','--no-checkout',
        'https://github.com/caddyserver/caddy.git',str(WORK/'caddy')],'upstream-clone')
    command(['git','-C',str(WORK/'caddy'),'checkout','--detach',UPSTREAM],'upstream-checkout')
    assert subprocess.check_output(['git','-C',str(WORK/'caddy'),'rev-parse','HEAD']).decode().strip()==UPSTREAM
    (OUT/'original-upstream-source-sha256.json').write_text(json.dumps(source_ledger(),indent=2)+'\n')
    (OUT/'input-go.mod').write_bytes((WORK/'edge/go.mod').read_bytes())
    (OUT/'input-go.sum').write_bytes((WORK/'edge/go.sum').read_bytes())
    go(['mod','download','all'],'initial-normal-download')
    modules=stream_json(go(['list','-m','-json','all'],'original-module-graph'))
    targets=catalogs(modules,'original-graph')
    (OUT/'stable-target-catalog.json').write_text(json.dumps(targets,indent=2)+'\n')
    for row in targets:
        if row['canonical_final_target'] and re.fullmatch(r'v\d+\.\d+\.\d+(?:\+incompatible)?',row['installed'] or ''):
            key=lambda v:tuple(map(int,v.split('+')[0][1:].split('.')))
            assert key(row['canonical_final_target'])>=key(row['installed']), 'Refusing a module downgrade'
    updates=[r['module']+'@'+r['canonical_final_target'] for r in targets
        if r['canonical_final_target'] and r['installed']!=r['canonical_final_target']
        and re.fullmatch(r'v\d+\.\d+\.\d+(?:\+incompatible)?',r['installed'] or '')]
    # Ordinary module requests in our own wrapper; no replace/exclude/forced graph.
    if updates: go(['get',*updates],'normal-stable-refresh')
    go(['mod','tidy'],'normal-tidy')
    go(['mod','verify'],'normal-module-integrity')
    for name in ['go.mod','go.sum']:
        (OUT/name).write_bytes((WORK/'edge'/name).read_bytes())
    assert not re.search(r'^\s*(replace|exclude)\b',(WORK/'edge/go.mod').read_text(),re.M)
    (OUT/'refresh-summary.json').write_text(json.dumps({'upstream_commit':UPSTREAM,
        'go_sdk_image':IMAGE,'normal_requests':updates,'whole_input_graph_modules':len(modules),
        'unqualified_untagged_or_pseudo_modules':[r for r in targets if not r['canonical_final_target']
             or not re.fullmatch(r'v\d+\.\d+\.\d+(?:\+incompatible)?',r['installed'] or '')],
        'application_or_operator_data_changed':False},indent=2)+'\n')
elif phase=='build':
    go(['build','-mod=readonly','-trimpath','-o','/work/evidence/caddy','.'],'current-graph-build')
    go(['version','-m','/work/evidence/caddy'],'actual-binary-build-info')
    go(['list','-mod=readonly','-deps','.'],'actual-compiled-packages')
    (OUT/'binary-sha256.txt').write_text(hashlib.sha256((OUT/'caddy').read_bytes()).hexdigest()+'\n')
elif phase=='original':
    go(['work','init','./edge','./caddy'],'original-workspace',directory='')
    go(['list','-m','-json','all'],'original-suite-effective-module-graph',directory='caddy',workspace=True)
    # Run the original complete package command without editing a source case,
    # adding -short/-run filters, or modifying the upstream module manifest.
    result=None
    try:
        go(['test','./...'],'original-full-upstream-cases',directory='caddy',workspace=True)
    except subprocess.CalledProcessError as error:
        result=error
    current=source_ledger()
    expected=json.loads((OUT/'original-upstream-source-sha256.json').read_text())
    (OUT/'post-suite-upstream-source-sha256.json').write_text(json.dumps(current,indent=2)+'\n')
    assert current==expected, 'Original upstream source/cases changed during qualification'
    if result: raise result
elif phase=='graph':
    modules=stream_json(go(['list','-m','-json','all'],'candidate-module-graph'))
    rows=catalogs(modules,'candidate-graph')
    gaps=[r for r in rows if r['installed']!=r['canonical_final_target']]
    (OUT/'complete-stable-graph-review.json').write_text(json.dumps({
        'captured_at':datetime.now(timezone.utc).isoformat(),'modules':rows,
        'noncurrent_or_unknown':gaps,'all_modules_current':not gaps,
        'advisory_waiver':False,'deployed_or_real_data_acceptance':False},indent=2)+'\n')
    assert not gaps, f'{len(gaps)} noncurrent or unqualified modules remain'
else:
    raise SystemExit('Unknown phase')
