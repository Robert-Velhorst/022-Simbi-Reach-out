"""Validate an exact-image package inventory without suppressed findings."""
from pathlib import Path
import json
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
profile = sys.argv[3] if len(sys.argv) > 3 else 'api'
assert profile in {'api', 'caddy'}
report = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
image_id = Path(sys.argv[2]).read_text(encoding='ascii').strip()
assert re.fullmatch(r'sha256:[a-f0-9]{64}', image_id)
assert report['SchemaVersion'] == 2 and report['ArtifactType'] == 'container_image'
assert report['Metadata']['ImageID'] == image_id
assert report['Metadata']['OS']['Family'] == ('debian' if profile == 'api' else 'alpine')
if profile == 'api':
    assert report['Metadata']['OS']['Name'].split('.')[0] == '13'
else:
    assert report['Metadata']['OS']['Name'] == '3.24.3'
assert report['Metadata']['OS'].get('EOSL', False) is False
assert isinstance(report['Results'], list) and report['Results']
installed = {}
os_packages = 0
for result in report['Results']:
    assert isinstance(result['Packages'], list) and result['Packages']
    for key in ['Vulnerabilities', 'ExperimentalModifiedFindings']:
        if key in result:
            assert isinstance(result[key], list) and not result[key], 'Unresolved or modified findings: '+key
    if result['Class'] == 'os-pkgs':
        assert result['Type'] == ('debian' if profile == 'api' else 'alpine')
        os_packages += len(result['Packages'])
    for package in result['Packages']:
        assert package['Name'] and package['Version']
        name = re.sub(r'[-_.]+', '-', package['Name'].lower())
        installed.setdefault(name, set()).add(package['Version'])
assert os_packages > 0
dependencies = tomllib.loads((ROOT / 'pyproject.toml').read_text(encoding='utf-8'))['project']['dependencies'] if profile == 'api' else []
for dependency in dependencies:
    match = re.fullmatch(r'([\w.-]+)(?:\[[\w,.-]+\])?==([\w.+-]+)', dependency)
    assert match, 'Direct runtime dependency must be exactly pinned'
    name = re.sub(r'[-_.]+', '-', match[1].lower())
    assert match[2] in installed.get(name, set()), 'Missing exact installed runtime dependency: '+name
if profile == 'api':
    sqlite = json.loads((ROOT / 'sqlite-runtime.json').read_text(encoding='utf-8'))
    assert installed.get('libsqlite3-0') == {sqlite['version']+'-0simbi1'}, 'The distribution SQLite package must also be upgraded'
if profile == 'caddy':
    assert any(value.removeprefix('v') == '2.11.7' for value in installed.get('github-com/caddyserver/caddy/v2', set())), 'Missing exact Caddy module'
print(json.dumps({'passed':True,'image_id':image_id,'os_packages':os_packages,
                  'profile':profile,
                  'direct_python_dependencies':len(dependencies),'inventory_names':len(installed),
                  'scope':'Recorded OS and Python/Go package findings; separate native probes remain required',
                  'deployment_acceptance':False}))
