"""Verify the pinned edge config offline; never bind ports or obtain certificates."""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
reports = ROOT / '.qualification/reports'
reports.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'compose.production.yaml').read_text(encoding='utf-8')
match = re.search(r'^\s+image: (caddy:([0-9]+\.[0-9]+\.[0-9]+)-alpine@sha256:[0-9a-f]{64})$', source, re.M)
assert match, 'The edge image must be pinned to an exact stable version and digest'
image, version = match.groups()
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
validation = run([*base, '--env', 'SIMBI_DOMAIN=simbi.example.test',
    '--volume', str(ROOT / 'Caddyfile')+':/etc/caddy/Caddyfile:ro',
    image, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
report = {'image':image,'version':actual,'build_info':build,'config_validation':validation.stdout.strip(),
          'network':'none','ports_published':False,'operator_configuration_modified':False,
          'live_tls_acceptance':False,'all_bundled_modules_current':False}
output = ROOT / '.qualification/reports/caddy-runtime.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
inputs = ROOT / '.qualification/input'
inputs.mkdir(parents=True, exist_ok=True)
image_id = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).stdout.strip()
(output.parent / 'caddy-image-id.txt').write_text(image_id+'\n', encoding='ascii')
run(['docker', 'image', 'save', image, '-o', str(inputs / 'caddy.tar')])
print(json.dumps({'pinned_version':version,'actual_version':actual,'offline_config_validated':True,'live_tls_acceptance':False}))
