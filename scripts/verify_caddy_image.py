"""Verify the pinned edge config offline; never bind ports or obtain certificates."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

from archive_image_identity import archive_identity

ROOT = Path(__file__).resolve().parents[1]
reports = ROOT / '.qualification/reports'
reports.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'Dockerfile.caddy').read_text(encoding='utf-8')
match = re.search(r'^FROM (caddy:([0-9]+\.[0-9]+\.[0-9]+)-alpine@sha256:[0-9a-f]{64}) AS official$', source, re.M)
assert match, 'The edge image must be pinned to an exact stable version and digest'
source_image, version = match.groups()
image = 'simbi-reach-out-edge:'+version
assert 'image: simbi-reach-out-edge:${SIMBI_EDGE_IMAGE_TAG:-'+version+'}' in (ROOT / 'compose.production.yaml').read_text(encoding='utf-8')
base = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '10001:10001',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/data:rw,noexec,nosuid,size=16m,mode=1777',
        '--tmpfs', '/config:rw,noexec,nosuid,size=16m,mode=1777']
def run(arguments):
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, timeout=180)
    destination = reports / ('caddy-command-'+str(len(list(reports.glob('caddy-command-*.json')))+1)+'.json')
    destination.write_text(json.dumps({'arguments':arguments,'returncode':result.returncode,
        'stdout':result.stdout,'stderr':result.stderr},indent=2)+'\n',encoding='utf-8')
    if result.returncode:
        sys.stderr.write(result.stderr)
        sys.stderr.write(result.stdout)
        result.check_returncode()
    return result
actual = run([*base, image, 'caddy', 'version']).stdout.strip()
assert actual.split()[0] in {version, 'v'+version}
build = run([*base, image, 'caddy', 'build-info']).stdout
assert re.search(r'^go\s+go1\.27\.3$', build, re.M), 'The installed edge must use Go 1.27.3'
binary_hash = run([*base, image, 'sha256sum', '/usr/bin/caddy']).stdout.split()[0]
evidence = run([*base, image, 'cat', '/usr/share/caddy/build/evidence.sha256']).stdout
hashes = dict((name, digest) for digest, name in (line.split() for line in evidence.splitlines()))
assert set(hashes) == {'caddy', 'build-info.txt', 'linked-packages.txt',
                       'build-environment.json', 'go.mod', 'go.sum', 'LICENSE'}
assert hashes['caddy'] == binary_hash
files = {}
for name in sorted(set(hashes) - {'caddy'}):
    content = run([*base, image, 'cat', '/usr/share/caddy/build/'+name]).stdout
    assert hashlib.sha256(content.encode('utf-8')).hexdigest() == hashes[name], 'Mismatched build evidence: '+name
    files[name] = content
assert files['go.mod'] == (ROOT / 'edge/go.mod').read_text(encoding='utf-8')
assert files['go.sum'] == (ROOT / 'edge/go.sum').read_text(encoding='utf-8')
environment = json.loads(files['build-environment.json'])
assert environment['GOVERSION'] == 'go1.27.3' and environment['CGO_ENABLED'] == '0'
assert environment['GOOS'] == 'linux'
locked = dict(re.findall(r'^\s*(\S+)\s+(v\S+)(?:\s+// indirect)?$', files['go.mod'], re.M))
locked['github.com/caddyserver/caddy/v2'] = version if version.startswith('v') else 'v'+version
dependencies = re.findall(r'^dep\s+(\S+)\s+(v\S+)\s+(h1:\S+)$', build, re.M)
assert dependencies and any(name == 'github.com/caddyserver/caddy/v2' for name, _, _ in dependencies)
for name, installed_version, checksum in dependencies:
    assert locked.get(name) == installed_version, 'Installed Go module differs from source lock: '+name
    assert f'{name} {installed_version} {checksum}' in files['go.sum'].splitlines(), 'Missing module checksum: '+name
linked = files['linked-packages.txt'].splitlines()
assert linked and linked == sorted(set(linked)), 'Compile package evidence must be nonempty and unique'
assert 'github.com/Robert-Velhorst/022-Simbi-Reach-out/edge' in linked
assert 'github.com/caddyserver/caddy/v2/modules/standard' in linked
unsafe_openpgp = [name for name in linked if name == 'golang.org/x/crypto/openpgp'
                 or name.startswith('golang.org/x/crypto/openpgp/')]
validation = run([*base, '--env', 'SIMBI_DOMAIN=simbi.example.test',
    '--volume', str(ROOT / 'Caddyfile')+':/etc/caddy/Caddyfile:ro',
    image, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
report = {'image':image,'source_image':source_image,'version':actual,'build_info':build,'config_validation':validation.stdout.strip(),
          'network':'none','ports_published':False,'operator_configuration_modified':False,
          'live_tls_acceptance':False,'all_bundled_modules_current':False,
          'source_mode':'checksum-locked standard Caddy modules with Go 1.27.3',
          'binary_sha256':binary_hash,'build_evidence_hashes':hashes,
          'build_environment':environment,'locked_binary_modules':len(dependencies),
          'compiled_package_count':len(linked),'unsafe_openpgp_compiled_packages':unsafe_openpgp,
          'advisory_suppression':False}
output = ROOT / '.qualification/reports/caddy-runtime.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
inputs = ROOT / '.qualification/input'
inputs.mkdir(parents=True, exist_ok=True)
inspection = run(['docker', 'image', 'inspect', image]).stdout
(output.parent / 'caddy-image-inspect.json').write_text(inspection, encoding='utf-8')
run(['docker', 'image', 'save', image, '-o', str(inputs / 'caddy.tar')])
identity = archive_identity(inputs / 'caddy.tar', json.loads(inspection), image)
(output.parent / 'caddy-image-identity.json').write_text(json.dumps(identity,indent=2)+'\n', encoding='utf-8')
(output.parent / 'caddy-image-id.txt').write_text(identity['config_id']+'\n', encoding='ascii')
print(json.dumps({'pinned_version':version,'actual_version':actual,'offline_config_validated':True,'live_tls_acceptance':False}))
