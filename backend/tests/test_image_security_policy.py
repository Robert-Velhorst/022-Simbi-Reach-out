"""Ensure image reports cannot pass with missing coverage or retained findings."""
# ruff: noqa: S603 -- fixed interpreter, source script and test-owned JSON paths.
import copy
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'sha256:' + 'a' * 64


def fixture_report():
    declarations = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['dependencies']
    packages = []
    for declaration in declarations:
        match = re.fullmatch(r'([\w.-]+)(?:\[[\w,.-]+\])?==([\w.+-]+)', declaration)
        assert match
        packages.append({'Name':match[1], 'Version':match[2]})
    return {'SchemaVersion':2,'ArtifactType':'container_image',
        'Metadata':{'ImageID':IMAGE,'OS':{'Family':'debian','Name':'13.2','EOSL':False}},
        'Results':[{'Class':'os-pkgs','Type':'debian','Packages':[{'Name':'libc6','Version':'synthetic'},
            {'Name':'libsqlite3-0','Version':'3.54.1-0simbi1'}]},
            {'Class':'lang-pkgs','Type':'python-pkg','Packages':packages}]}


def check(tmp_path, report):
    data = tmp_path / 'report.json'
    data.write_text(json.dumps(report))
    image = tmp_path / 'image-id.txt'
    image.write_text(IMAGE)
    return subprocess.run([sys.executable, str(ROOT / 'scripts/verify_image_security.py'),
        str(data), str(image)], capture_output=True, text=True, timeout=30)


def test_complete_image_report_passes(tmp_path):
    result = check(tmp_path, fixture_report())
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)['direct_python_dependencies'] == len(fixture_report()['Results'][1]['Packages'])


@pytest.mark.parametrize('mutation', ['wrong-image','missing-runtime','empty-results',
    'no-os-packages','vulnerability','modified-finding','wrong-distribution','old-sqlite-package'])
def test_incomplete_or_affected_image_report_fails(tmp_path, mutation):
    report = copy.deepcopy(fixture_report())
    if mutation == 'wrong-image':
        report['Metadata']['ImageID'] = 'sha256:' + 'b' * 64
    elif mutation == 'missing-runtime':
        report['Results'][1]['Packages'].pop()
    elif mutation == 'empty-results':
        report['Results'] = []
    elif mutation == 'no-os-packages':
        report['Results'].pop(0)
    elif mutation == 'vulnerability':
        report['Results'][0]['Vulnerabilities'] = [{'VulnerabilityID':'synthetic-CVE'}]
    elif mutation == 'modified-finding':
        report['Results'][0]['ExperimentalModifiedFindings'] = [{'Status':'accepted'}]
    elif mutation == 'old-sqlite-package':
        report['Results'][0]['Packages'][1]['Version'] = '3.46.1-7'
    else:
        report['Metadata']['OS']['Family'] = 'alpine'
    assert check(tmp_path, report).returncode != 0
