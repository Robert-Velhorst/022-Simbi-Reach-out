import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']
const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

// Add only fictional legacy records to the validated, owned test database.
// Provider traffic stays blocked by the retained parent harness.
export async function conversationRecordsWorkflow(page, origin, root, runtime, python, axe, screenshots) {
  if (dirname(resolve(runtime)) !== resolve(root, '.e2e-runtime') || !readFileSync(join(runtime, 'simbi-e2e.db')).length) throw new Error('Unsafe conversation fixture target')
  const snapshot = async () => {
    const result = await page.request.get(`${origin}/api/export`)
    assert.ok(result.ok())
    const data = await result.json()
    return Object.fromEntries(tables.map((table) => { assert.ok(Array.isArray(data[table])); return [table, data[table]] }))
  }
  const memberResponse = await page.request.get(`${origin}/api/me`)
  assert.ok(memberResponse.ok())
  const member = await memberResponse.json()
  let scans = 0
  for (const locale of ['en', 'nl']) {
    const t = (key) => { assert.ok(Object.hasOwn(catalogs[locale], key)); return catalogs[locale][key] }
    const preserved = await snapshot()
    const fixture = JSON.parse(execFileSync(python, ['-c', `
import datetime, json, sqlite3, sys
database, locale, workspace, user = sys.argv[1:]
workspace=int(workspace); user=int(user)
with sqlite3.connect(database) as c:
    c.execute('PRAGMA foreign_keys=ON')
    stamp=datetime.datetime.now(datetime.UTC).isoformat()
    campaign=c.execute('SELECT id FROM campaigns WHERE workspace_id=? ORDER BY id LIMIT 1',(workspace,)).fetchone()[0]
    prospect=c.execute('INSERT INTO prospects(workspace_id,name,source_url,created_at,updated_at) VALUES (?,?,?,?,?)',
        (workspace,f'Fictional chronological contact {locale}',f'https://simbi.com/fictional-chronology-{locale}',stamp,stamp)).lastrowid
    draft=c.execute("INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,state,quality_score,created_at,updated_at) VALUES (?,?,?,'Fictional chronology fixture','replied',90,?,?)",
        (workspace,campaign,prospect,stamp,stamp)).lastrowid
    ids={'replies':[], 'reminders':[], 'invalid':{'replies':[], 'reminders':[]}}
    for index in range(52):
        text=f'Fictional chronology {locale} {index:02}'
        for table,year in [('replies',2098 if locale=='en' else 2099),('reminders',2001 if locale=='en' else 2000)]:
            instant=datetime.datetime(year,10,1,22,0,0,index,tzinfo=datetime.UTC)
            if index%2:
                value=(instant+datetime.timedelta(hours=2)).isoformat().replace('+00:00','+02:00')
            else: value=instant.isoformat().replace('+00:00','Z')
            if table=='replies':
                record=c.execute('INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)',
                    (workspace,draft,text,value,user,stamp)).lastrowid
            else:
                record=c.execute("INSERT INTO reminders(workspace_id,draft_id,prospect_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,?,'user',?)",
                    (workspace,draft,prospect,text,value,stamp)).lastrowid
            ids[table].append(record)
    for index,value in enumerate(['2026-02-30T12:00:00Z','2026-10-01T12:00:00','9999-12-31T23:59:59-00:01']):
        text=f'Fictional unrecognized date {locale} {index}'
        reply=c.execute('INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)',
            (workspace,draft,text,value,user,stamp)).lastrowid
        reminder=c.execute("INSERT INTO reminders(workspace_id,draft_id,prospect_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,?,'user',?)",
            (workspace,draft,prospect,text,value,stamp)).lastrowid
        ids['invalid']['replies'].append({'id':reply,'text':text,'value':value})
        ids['invalid']['reminders'].append({'id':reminder,'text':text,'value':value})
    print(json.dumps(ids))
`, join(runtime, 'simbi-e2e.db'), locale, String(member.workspace_id), String(member.user_id)], { encoding: 'utf8', timeout: 10000 }))
    const seeded = await snapshot()
    for (const table of tables) {
      const oldIds = new Set(preserved[table].map((row) => row.id))
      assert.deepEqual(seeded[table].filter((row) => oldIds.has(row.id)), preserved[table], `Chronology fixtures changed prior ${table}`)
    }
    const writes = []
    const record = (request) => {
      if (request.url().startsWith(`${origin}/api/`) && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method())
    }
    page.on('request', record)
    try {
      await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
      await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
      for (const [table, label, selector] of [['replies', 'Replies', '.conversation-list article p'], ['reminders', 'Reminders', '.task-list article strong']]) {
        await page.goto(`${origin}/${table}`, { waitUntil: 'networkidle' })
        assert.equal(new URL(page.url()).pathname, `/${table}`)
        assert.ok((await page.title()).includes('Simbi'))
        await page.getByRole('heading', { name: t(label), exact: true }).waitFor()
        const order = table === 'replies' ? [...fixture[table]].reverse() : fixture[table]
        const indices = table === 'replies' ? Array.from({ length: 52 }, (_, i) => 51 - i) : Array.from({ length: 52 }, (_, i) => i)
        const text = (index) => `Fictional chronology ${locale} ${String(index).padStart(2, '0')}`
        assert.deepEqual(await page.locator(selector).allTextContents(), indices.slice(0, 50).map(text))
        const firstResponse = await page.request.get(`${origin}/api/${table}?limit=50&offset=0`)
        assert.ok(firstResponse.ok())
        assert.deepEqual((await firstResponse.json()).items.map(({ id }) => id), order.slice(0, 50))
        const next = page.getByRole('button', { name: t('Next page'), exact: true })
        await next.focus()
        await page.keyboard.press('Enter')
        await page.getByText(text(indices[50]), { exact: true }).waitFor()
        assert.deepEqual((await page.locator(selector).allTextContents()).slice(0, 2), indices.slice(50).map(text))
        const previous = page.getByRole('button', { name: t('Previous page'), exact: true })
        await previous.focus()
        await page.keyboard.press('Enter')
        await page.getByText(text(indices[0]), { exact: true }).waitFor()
        assert.deepEqual(await page.locator(selector).allTextContents(), indices.slice(0, 50).map(text))
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        await page.addScriptTag({ content: axe.source })
        const findings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
        assert.equal(findings.violations.length, 0)
        scans++
        await page.screenshot({ path: join(screenshots, `simbi-chronology-${locale}-${table}.png`), fullPage: false })

        // Reach the real final page using visible controls, not response mocks.
        const total = (await firstResponse.json()).total
        for (let offset = 50; offset < total; offset += 50) {
          const response = page.waitForResponse((result) => {
            const url = new URL(result.url())
            return url.pathname === `/api/${table}` && url.searchParams.get('offset') === String(offset) && result.ok()
          })
          await next.focus()
          await page.keyboard.press('Enter')
          await response
          // A completed network read is not yet rendered React settlement.
          const expectedPage = t('{first}–{last} of {total}').replace('{first}', String(offset + 1)).replace('{last}', String(Math.min(offset + 50, total))).replace('{total}', String(total))
          await page.getByText(expectedPage, { exact: true }).waitFor({ state: 'visible' })
        }
        const lastOffset = Math.floor((total - 1) / 50) * 50
        const lastResponse = await page.request.get(`${origin}/api/${table}?limit=50&offset=${lastOffset}`)
        assert.ok(lastResponse.ok())
        const lastItems = (await lastResponse.json()).items
        const invalid = fixture.invalid[table]
        assert.deepEqual(lastItems.filter((item) => invalid.some(({ id }) => id === item.id)).map(({ id }) => id), (table === 'replies' ? [...invalid].reverse() : invalid).map(({ id }) => id))
        for (const item of invalid) {
          const article = page.locator('article').filter({ has: page.getByText(item.text, { exact: true }) })
          await article.waitFor({ state: 'visible' })
          assert.equal(await article.locator('time').textContent(), t('Unrecognized date: {value}').replace('{value}', () => item.value))
          const stored = lastItems.find(({ id }) => id === item.id)
          assert.equal(stored[table === 'replies' ? 'received_at' : 'due_at'], item.value)
        }
        assert.equal(await next.isDisabled(), true)
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        const invalidFindings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
        assert.equal(invalidFindings.violations.length, 0)
        scans++
        await page.locator('article').filter({ has: page.getByText(invalid[0].text, { exact: true }) }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(screenshots, `simbi-unrecognized-dates-${locale}-${table}.png`), fullPage: false })
      }
      assert.deepEqual(await snapshot(), seeded, 'Reading/paging legacy times changed stored records')
      assert.deepEqual(writes, [], 'Reading chronological pages must not write records')
    } finally { page.off('request', record) }
  }
  assert.equal(scans, 8)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
}
