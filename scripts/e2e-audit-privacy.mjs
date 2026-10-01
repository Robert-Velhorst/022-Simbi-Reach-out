import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

export async function auditPrivacyWorkflow(page, origin, root, runtime, python, passphrase, axe, screenshots) {
  // Historical fixtures bypass the new-write sanitizer only in OUR new E2E DB.
  if (dirname(resolve(runtime)) !== resolve(root, '.e2e-runtime') || !readFileSync(join(runtime, 'simbi-e2e.db')).length) throw new Error('Unsafe historical audit fixture target')
  const database = join(runtime, 'simbi-e2e.db')
  for (const locale of ['en', 'nl']) {
    const t = (key) => catalogs[locale][key] ?? (() => { throw new Error(`Missing audit QA translation: ${key}`) })()
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    const records = [
      ['prospect.suppressed', { reason: `Fictional old private reason ${locale}`, evidence: 'preserve' }],
      ['provider.updated', { base_url: `https://simbi.com/fictional-private-${locale}?context=old`, mode: 'assisted' }],
      ['draft.approved', { checks: ['source_authorized', 'message_personalized', 'policy_reviewed', 'manual_send_understood', `Fictional private check ${locale}`], content_hash: 'a'.repeat(64) }],
      ['draft.declined', { checks: [`Fictional private check ${locale}`, 'source_authorized'] }],
    ]
    const ids = JSON.parse(execFileSync(python, ['-c', `
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as c:
    c.execute('PRAGMA foreign_keys=ON')
    ids=[]
    for event,details in json.loads(sys.argv[2]):
        ids.append(c.execute("INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) VALUES (1,1,?,'fictional','7',?,'2020-01-01T00:00:00+00:00')",(event,json.dumps(details))).lastrowid)
    print(json.dumps(ids))
`, database, JSON.stringify(records)], { encoding: 'utf8', timeout: 10000 }))
    const before = await (await page.request.get(`${origin}/api/export`)).json()
    const beforeSettings = await (await page.request.get(`${origin}/api/settings`)).json()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
    await page.getByRole('link', { name: t('Settings'), exact: true }).click()
    await button('Preview old audit details').click()
    await page.getByRole('heading', { name: t('Audit detail preview') }).waitFor()
    assert.ok(!(await page.locator('body').innerText()).includes(`Fictional old private reason ${locale}`))
    for (const id of ids) await page.getByText(new RegExp(`${locale === 'nl' ? 'Gebeurtenis' : 'Event'} ${id}:`)).waitFor()
    await button('Review audit minimization').click()
    const dialog = page.getByRole('dialog', { name: t('Confirm audit minimization') })
    await dialog.getByLabel(t('Local account password')).fill(passphrase)
    await dialog.getByRole('checkbox').check()
    await page.screenshot({ path: resolve(screenshots, `simbi-audit-privacy-${locale}-desktop.png`) })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await button('Review audit minimization').evaluate((element) => document.activeElement === element), 'Cancel must return focus')
    const cancelled = await (await page.request.get(`${origin}/api/export`)).json()
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) assert.deepEqual(cancelled[table], before[table])
    assert.deepEqual(cancelled.audit_events.filter(({ id }) => ids.includes(id)), before.audit_events.filter(({ id }) => ids.includes(id)))
    await button('Review audit minimization').click()
    assert.equal(await dialog.getByLabel(t('Local account password')).inputValue(), '')
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
    await page.setViewportSize({ width: 390, height: 450 })
    assert.ok(await dialog.evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1 }), 'Short-mobile audit dialog must fit')
    await page.screenshot({ path: resolve(screenshots, `simbi-audit-privacy-${locale}-mobile.png`) })
    await page.addScriptTag({ content: axe.source })
    const findings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
    assert.deepEqual(findings.violations.map(({ id }) => id), [], `Audit privacy ${locale} accessibility`)
    // Commit once, then deliberately substitute an unverified success response.
    // UI must NOT claim completion; retry must return the existing receipt.
    let committed
    await page.route(`${origin}/api/privacy/audit/confirm`, async (route) => {
      const result = await route.fetch()
      assert.ok(result.ok(), await result.text())
      committed = await result.json()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...committed, plan_id: 'f'.repeat(32) }) })
    })
    await dialog.getByRole('checkbox').check()
    await dialog.getByLabel(t('Local account password')).fill(passphrase)
    await dialog.getByRole('button', { name: t('Confirm audit update'), exact: true }).click()
    await dialog.getByText(t('Audit minimization is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.')).waitFor()
    assert.equal(await dialog.getByLabel(t('Local account password')).inputValue(), '')
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
    assert.equal(committed.counts.audit_events, 4)
    await page.unroute(`${origin}/api/privacy/audit/confirm`)
    await dialog.getByRole('checkbox').check()
    await dialog.getByLabel(t('Local account password')).fill(passphrase)
    await dialog.getByRole('button', { name: t('Confirm audit update'), exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText(t('This is the existing receipt; the audit update was not repeated.')).waitFor()
    const after = await (await page.request.get(`${origin}/api/export`)).json()
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) assert.deepEqual(after[table], before[table])
    assert.deepEqual((await (await page.request.get(`${origin}/api/settings`)).json()).providers, beforeSettings.providers)
    for (const id of ids) {
      const old = before.audit_events.find((item) => item.id === id)
      const current = after.audit_events.find((item) => item.id === id)
      assert.deepEqual({ ...current, details: old.details }, old, 'Core event evidence changed')
      const details = JSON.parse(current.details)
      assert.ok(!Object.hasOwn(details, 'reason') && !Object.hasOwn(details, 'base_url'))
      if (details.checks) assert.ok(!details.checks.some((check) => check.startsWith('Fictional private')))
      if (old.event_type === 'draft.approved') assert.equal(details.content_hash, 'a'.repeat(64))
    }
    execFileSync(python, ['-c', `
import json, pathlib, sqlite3, sys
source=pathlib.Path(sys.argv[1]).resolve(); backup=source.parent/'cleanup-backups'/sys.argv[2]
assert backup.parent.resolve()==(source.parent/'cleanup-backups').resolve() and backup.suffix=='.db'
with sqlite3.connect(backup) as c:
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not c.execute('PRAGMA foreign_key_check').fetchall()
    for event_id, expected in zip(json.loads(sys.argv[3]),json.loads(sys.argv[4])):
        assert json.loads(c.execute('SELECT details FROM audit_events WHERE id=?',(event_id,)).fetchone()[0])==expected[1]
with sqlite3.connect(source) as c:
    assert c.execute("SELECT COUNT(*) FROM audit_events WHERE event_type='privacy.audit_minimized' AND entity_id=?",(sys.argv[5],)).fetchone()[0]==1
`, database, committed.backup_file, JSON.stringify(ids), JSON.stringify(records), committed.plan_id], { timeout: 10000 })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload({ waitUntil: 'networkidle' })
    await button('Check audit minimization receipts').click()
    await page.getByText(new RegExp(locale === 'nl' ? 'Bijgewerkte gebeurtenissen: 4' : 'Events updated: 4')).first().waitFor()
    const receipts = await (await page.request.get(`${origin}/api/privacy/audit/receipts`)).json()
    assert.equal(receipts.items.length, locale === 'en' ? 1 : 2)
    assert.ok(receipts.items.some(({ plan_id }) => plan_id === committed.plan_id))
    await button('Preview old audit details').click()
    await page.getByText(t('No eligible duplicate text was selected on this scan page. This does not mean all history is free of personal data.')).waitFor()
    assert.equal(await button('Review audit minimization').isEnabled(), false)
  }
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
}
