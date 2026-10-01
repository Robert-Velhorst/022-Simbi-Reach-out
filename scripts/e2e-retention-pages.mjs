import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

export async function retentionPagesWorkflow(page, origin, root, runtime, python, passphrase, axe, screenshots, expectAbort) {
  if (dirname(resolve(runtime)) !== resolve(root, '.e2e-runtime') || !readFileSync(join(runtime, 'simbi-e2e.db')).length) throw new Error('Unsafe retention fixture target')
  const database = join(runtime, 'simbi-e2e.db')
  for (const locale of ['en', 'nl']) {
    const t = (key) => catalogs[locale][key] ?? (() => { throw new Error(`Missing retention QA translation: ${key}`) })()
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    const oldIds = JSON.parse(execFileSync(python, ['-c', `
import datetime, json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as c:
    c.execute('PRAGMA foreign_keys=ON')
    recent=datetime.datetime.now(datetime.UTC).isoformat(); ids=[]
    for number in range(1053):
        stamp=recent if number<1000 else '2020-01-01T00:00:00+00:00'
        event_id=c.execute('INSERT INTO prospects(workspace_id,name,source_url,created_at,updated_at) VALUES (1,?,?,?,?)',
            (f'Fictional retention {sys.argv[2]} {number}',f'https://simbi.com/retention-{sys.argv[2]}-{number}',stamp,stamp)).lastrowid
        if number>=1000: ids.append(event_id)
    print(json.dumps(ids))
`, database, locale], { encoding: 'utf8', timeout: 10000 }))
    const before = await (await page.request.get(`${origin}/api/export`)).json()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
    await page.getByRole('link', { name: t('Settings'), exact: true }).click()
    await page.getByLabel(t('Cleanup scope')).selectOption('retention')
    async function scan(control) {
      const response = page.waitForResponse((result) => result.url() === `${origin}/api/privacy/preview` && result.request().method() === 'POST')
      await button(control).click()
      const result = await response
      assert.ok(result.ok(), await result.text())
      const plan = await result.json()
      await page.getByRole('heading', { name: t('Removal preview') }).waitFor()
      await page.getByText(t('Cleanup reference: {reference}.').replace('{reference}', plan.plan_id), { exact: true }).waitFor()
      return plan
    }
    let plan = await scan('Preview cleanup')
    assert.equal(plan.scanned_contacts, 1000)
    assert.equal(plan.protected_contacts, 1000)
    assert.equal(plan.counts.prospects, 0)
    assert.equal(plan.has_more_contacts, true)
    assert.equal(await button('Review removal').isEnabled(), false)
    const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: t('Privacy & cleanup'), exact: true }) })
    await panel.screenshot({ path: resolve(screenshots, `simbi-retention-${locale}-page.png`) })
    let pages = 1
    while (!plan.counts.prospects && plan.has_more_contacts) {
      assert.ok(pages++ < 5, 'Retention continuation did not reach eligible fixtures')
      const cursor = plan.next_after_id
      plan = await scan('Next contact scan page')
      assert.equal(plan.after_id, cursor)
    }
    assert.equal(plan.counts.prospects, 50)
    assert.equal(plan.remaining_eligible_contacts, 3)
    assert.deepEqual(plan.contacts.map(({ id }) => id), oldIds.slice(0, 50))
    const cursor = plan.after_id
    await button('Review removal').click()
    const dialog = page.getByRole('dialog', { name: t('Confirm local removal') })
    await dialog.getByRole('checkbox').check()
    await dialog.getByLabel(t('Local account password')).fill(passphrase)
    await page.setViewportSize({ width: 390, height: 450 })
    assert.ok(await dialog.evaluate((element) => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1 }))
    await page.screenshot({ path: resolve(screenshots, `simbi-retention-${locale}-mobile.png`) })
    await page.addScriptTag({ content: axe.source })
    const findings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
    assert.equal(findings.violations.length, 0)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await button('Review removal').evaluate((element) => document.activeElement === element))
    assert.deepEqual((await (await page.request.get(`${origin}/api/export`)).json()).prospects, before.prospects)
    await button('Review removal').click()
    assert.equal(await dialog.getByLabel(t('Local account password')).inputValue(), '')
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
    let committed
    expectAbort(locale === 'nl')
    await page.route(`${origin}/api/privacy/confirm`, async (route) => {
      const result = await route.fetch()
      assert.ok(result.ok(), await result.text())
      committed = await result.json()
      if (locale === 'nl') await route.abort('failed')
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...committed, counts: { ...committed.counts, prospects: 49 } }) })
    })
    async function confirm() {
      await dialog.getByRole('checkbox').check()
      await dialog.getByLabel(t('Local account password')).fill(passphrase)
      await dialog.getByRole('button', { name: t('Confirm removal'), exact: true }).click()
    }
    await confirm()
    await dialog.getByText(t('Cleanup is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.')).waitFor()
    assert.equal(await dialog.getByLabel(t('Local account password')).inputValue(), '')
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
    assert.equal(committed.plan_id, plan.plan_id)
    assert.equal(committed.counts.prospects, 50)
    await page.unroute(`${origin}/api/privacy/confirm`)
    await confirm()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText(t('This is the existing receipt; the removal was not repeated.')).waitFor()
    expectAbort(false)
    const after = await (await page.request.get(`${origin}/api/export`)).json()
    assert.deepEqual(after.prospects, before.prospects.filter(({ id }) => !oldIds.slice(0, 50).includes(id)))
    for (const table of ['campaigns', 'templates', 'drafts', 'handoffs', 'replies', 'reminders']) assert.deepEqual(after[table], before[table])
    for (const row of before.suppressions) assert.deepEqual(after.suppressions.find(({ id }) => id === row.id), row)
    for (let number = 1000; number < 1050; number++) assert.ok(after.suppressions.some(({ normalized_value, prospect_id }) => normalized_value === `simbi:https://simbi.com/retention-${locale}-${number}` && prospect_id === null))
    execFileSync(python, ['-c', `
import json, pathlib, sqlite3, sys
source=pathlib.Path(sys.argv[1]).resolve(); folder=source.parent/'cleanup-backups'; backup=folder/sys.argv[2]
assert backup.parent.resolve()==folder.resolve() and backup.suffix=='.db'
with sqlite3.connect(backup) as c:
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not c.execute('PRAGMA foreign_key_check').fetchall()
    for record_id in json.loads(sys.argv[3]): assert c.execute('SELECT id FROM prospects WHERE id=?',(record_id,)).fetchone()
with sqlite3.connect(source) as c:
    assert c.execute("SELECT COUNT(*) FROM audit_events WHERE event_type='privacy.cleanup_completed' AND entity_id=?",(sys.argv[4],)).fetchone()[0]==1
    assert json.loads(c.execute('SELECT receipt_json FROM privacy_cleanup_plans WHERE id=?',(sys.argv[4],)).fetchone()[0])['backup_file']==sys.argv[2]
`, database, committed.backup_file, JSON.stringify(oldIds), committed.plan_id], { timeout: 10000 })
    plan = await scan('Preview cleanup')
    assert.equal(plan.after_id, cursor)
    assert.deepEqual(plan.contacts.map(({ id }) => id), oldIds.slice(50))
    await button('Review removal').click()
    await confirm()
    await dialog.waitFor({ state: 'hidden' })
    plan = await scan('Preview cleanup')
    assert.equal(plan.counts.prospects, 0)
    await scan('Restart contact scan')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload({ waitUntil: 'networkidle' })
    await button('Check cleanup receipts').click()
    await page.getByText(new RegExp(locale === 'nl' ? 'Verwijderde contacten: 50' : 'Contacts removed: 50')).first().waitFor()
    const receipts = await (await page.request.get(`${origin}/api/privacy/receipts`)).json()
    assert.ok(receipts.items.some(({ plan_id }) => plan_id === committed.plan_id))
    const beforeLookup = await (await page.request.get(`${origin}/api/export`)).json()
    await page.getByLabel(t('Cleanup reference'), { exact: true }).fill(committed.plan_id)
    const lookup = page.waitForResponse((result) => result.url() === `${origin}/api/privacy/receipts/${committed.plan_id}` && result.request().method() === 'GET')
    await button('Find cleanup receipt by reference').click()
    const recovered = await lookup
    assert.ok(recovered.ok(), await recovered.text())
    assert.deepEqual(await recovered.json(), committed)
    await page.getByRole('status').filter({ hasText: t('Cleanup reference: {reference}.').replace('{reference}', committed.plan_id) }).waitFor()
    const afterLookup = await (await page.request.get(`${origin}/api/export`)).json()
    for (const table of ['campaigns', 'templates', 'prospects', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']) assert.deepEqual(afterLookup[table], beforeLookup[table])
  }
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
}
