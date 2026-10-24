"""Pinned native identity, startup rejection and synthetic engine upgrade."""
# ruff: noqa: S603 -- fixed interpreter and test-owned fixture paths only.
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

from app import db
from app.config import settings
from app.sqlite_runtime import (
    ROOT,
    platform_key,
    require_stable_sqlite,
    runtime_evidence,
    runtime_layout,
)


def original_process(root: Path, code: str):
    env = dict(os.environ)
    env.pop('PYTHONPATH', None)
    return subprocess.run([sys._base_executable, '-S', '-c', code], cwd=root,
                          env=env, capture_output=True, text=True, timeout=60)


def test_native_identity_and_features():
    sqlite = require_stable_sqlite()
    evidence = runtime_evidence()
    assert evidence['version'] == '3.54.1'
    assert 'THREADSAFE=1' in evidence['compile_options']
    with sqlite.connect(':memory:') as connection:
        assert connection.execute('SELECT sqlite_version()').fetchone()[0] == '3.54.1'
        connection.execute('CREATE VIRTUAL TABLE search USING fts5(value)')
        connection.execute('CREATE VIRTUAL TABLE spatial USING rtree(id,min,max)')
    connection.close()


def isolated_loader(root: Path):
    (root / 'backend/app').mkdir(parents=True)
    shutil.copyfile(ROOT / 'backend/app/sqlite_runtime.py', root / 'backend/app/sqlite_runtime.py')
    shutil.copyfile(ROOT / 'sqlite-runtime.json', root / 'sqlite-runtime.json')


def test_missing_native_runtime_cannot_create_a_database(tmp_path):
    isolated_loader(tmp_path)
    result = original_process(tmp_path,
        "import runpy; m=runpy.run_path('backend/app/sqlite_runtime.py'); m['require_stable_sqlite']().connect('operator.db')")
    assert result.returncode != 0
    assert 'Verified SQLite runtime missing' in result.stderr
    assert not (tmp_path / 'operator.db').exists()


def test_tampered_native_library_is_rejected_before_loading(tmp_path):
    isolated_loader(tmp_path)
    spec = json.loads((tmp_path / 'sqlite-runtime.json').read_text())
    key = platform_key()
    target = tmp_path / runtime_layout(spec, key).relative_to(ROOT)
    target.mkdir(parents=True)
    (target / spec[key]['library']).write_bytes(b'synthetic invalid native library')
    if not key.startswith('windows'):
        (target / 'integrity.json').write_text(json.dumps({'version':spec['version'],
            'source_sha3_256':spec[key]['archive_sha3_256'],'binary_sha256':'0' * 64}))
    result = original_process(tmp_path,
        "import runpy; m=runpy.run_path('backend/app/sqlite_runtime.py'); m['require_stable_sqlite']()")
    assert result.returncode != 0
    assert 'integrity check failed' in result.stderr


def test_bundled_engine_fixture_retains_schema_drafts_and_backup(tmp_path, monkeypatch, record_testsuite_property):
    # Raw old-engine SQL is confined to this new pytest fixture directory.
    result = original_process(tmp_path, '''import json,sqlite3
from pathlib import Path
c=sqlite3.connect('synthetic.db')
c.execute('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
for path in sorted(Path(__MIGRATIONS_PATH__).glob('*.sql')):
    c.executescript(path.read_text(encoding='utf-8'))
    c.execute("INSERT INTO schema_migrations VALUES(?, '2026-10-24T00:00:00Z')",(path.name,))
    c.commit()
stamp='2026-10-24T00:00:00Z'
c.execute("INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(1,'synthetic@example.test','synthetic-non-login-hash','Synthetic Owner',?)",(stamp,))
c.execute("INSERT INTO workspaces(id,name,created_at) VALUES(1,'Synthetic Workspace',?)",(stamp,))
c.execute("INSERT INTO campaigns(id,workspace_id,name,purpose,lawful_basis,created_at,updated_at) VALUES(1,1,'Synthetic campaign','fixture only','not configured',?,?)",(stamp,stamp))
c.execute("INSERT INTO prospects(id,workspace_id,name,source_url,created_at,updated_at) VALUES(1,1,'Synthetic Prospect','https://example.test/fixture',?,?)",(stamp,stamp))
c.execute("INSERT INTO drafts(id,workspace_id,campaign_id,prospect_id,body,quality_score,created_at,updated_at) VALUES(1,1,1,1,'Synthetic unsent draft',50,?,?)",(stamp,stamp))
c.commit()
schema=c.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
drafts=c.execute('SELECT * FROM drafts').fetchall()
print(json.dumps({'bundled_version':sqlite3.sqlite_version,'schema':schema,'drafts':drafts}))
c.close()
'''.replace('__MIGRATIONS_PATH__', repr(str(ROOT / 'backend/migrations'))))
    assert result.returncode == 0, result.stderr
    before = json.loads(result.stdout)
    record_testsuite_property('SQLiteOriginalEngine', before['bundled_version'])
    record_testsuite_property('SQLiteQualifiedEngine', runtime_evidence()['version'])
    monkeypatch.setattr(db, 'settings', replace(settings, database_path=tmp_path / 'synthetic.db'))
    assert db.migrate() == []
    sqlite = require_stable_sqlite()
    with db.connect() as connection:
        assert connection.execute('SELECT sqlite_version()').fetchone()[0] == '3.54.1'
        assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert connection.execute('PRAGMA journal_mode').fetchone()[0].lower() == 'wal'
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        schema = connection.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        assert [list(row) for row in schema] == before['schema']
        drafts = connection.execute('SELECT * FROM drafts').fetchall()
        assert [list(row) for row in drafts] == before['drafts']
        state = connection.execute('SELECT state,approved_at,sent_at FROM drafts').fetchone()
        assert tuple(state) == ('needs_review', None, None)
        connection.execute('BEGIN')
        connection.execute("UPDATE drafts SET body='rolled back' WHERE id=1")
        connection.rollback()
        assert connection.execute('SELECT body FROM drafts').fetchone()[0] == 'Synthetic unsent draft'
        backup = sqlite.connect(str(tmp_path / 'synthetic-backup.db'))
        try:
            connection.backup(backup)
            assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert backup.execute('SELECT * FROM drafts').fetchall() == [tuple(row) for row in drafts]
        finally:
            backup.close()
    connection.close()
