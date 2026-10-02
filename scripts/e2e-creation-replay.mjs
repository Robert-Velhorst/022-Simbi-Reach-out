import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']
const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

// Real UI-created fictional local records. Never provider sends or fake success.
export async function creationReplayWorkflow(page, origin, axe, screenshots, expectFailure) {
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.ok(response.ok())
    return response.json()
  }
  let scans = 0
  for (const locale of ['en', 'nl']) {
    const t = (key) => { assert.ok(Object.hasOwn(catalogs[locale], key)); return catalogs[locale][key] }
    const names = { campaign: `Fictional creation recovery campaign ${locale}`, prospect: `Fictional creation recovery person ${locale}`, template: `Fictional creation recovery template ${locale}` }
    const ids = {}
    await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
    const cases = [
      { operation: 'campaigns', route: '/campaigns', heading: 'Campaigns', open: 'New campaign', dialog: 'Create campaign', submit: 'Create draft campaign', fields: () => ({ name: names.campaign, purpose: 'Fictional local recovery acceptance; never contact anyone.', lawful_basis: 'Isolated fictional manual review; not provider permission.' }), changed: 'purpose' },
      { operation: 'prospects', route: '/prospects', heading: 'Prospects', open: 'Add prospect', dialog: 'Add prospect', submit: 'Add prospect', fields: () => ({ name: names.prospect, source_url: `https://simbi.com/never-send-creation-recovery-${locale}`, consent_status: 'contextual' }), changed: 'name' },
      { operation: 'templates', route: '/templates', heading: 'Templates', open: 'New template', dialog: 'Create template', submit: 'Create template', fields: () => ({ name: names.template, subject: 'FICTIONAL — NEVER SEND', body: 'Hello {name}. This is only fictional local recovery acceptance for {campaign}. No thanks is fine; nothing is sent.' }), changed: 'name' },
      { operation: 'drafts', route: '/review', heading: 'Review queue', open: 'Prepare draft', dialog: 'Prepare a deterministic draft', submit: 'Prepare draft', fields: () => ({ campaign_id: String(ids.campaigns), prospect_id: String(ids.prospects), template_id: String(ids.templates) }), changed: 'template_id' },
      { operation: 'replies', route: '/replies', heading: 'Replies', open: 'Record reply', dialog: 'Record provider reply', submit: 'Record reply', fields: () => ({ draft_id: String(ids.drafts), body: `Fictional recovery reply ${locale}; no provider contact.` }), changed: 'body' },
      { operation: 'prospects/import', route: '/prospects', heading: 'Prospects', open: 'Import CSV', dialog: 'Import reviewed prospects', submit: 'Validate and import', fields: () => ({ csv_text: `name,source_url,notes\nFictional recovery import ${locale},https://simbi.com/never-send-recovery-import-${locale},Fictional reviewed local CSV\n` }), changed: 'csv_text' },
    ]
    for (const item of cases) {
      await page.goto(`${origin}${item.route}`, { waitUntil: 'networkidle' })
      assert.equal(new URL(page.url()).pathname, item.route)
      assert.ok((await page.title()).includes('Simbi'))
      await page.getByRole('heading', { name: t(item.heading), exact: true }).waitFor()
      await page.getByRole('button', { name: t(item.open), exact: true }).click()
      const dialog = page.getByRole('dialog', { name: t(item.dialog), exact: true })
      const values = item.fields()
      for (const [name, value] of Object.entries(values)) {
        const control = dialog.locator(`[name=${name}]`)
        if (await control.evaluate((element) => element.tagName === 'SELECT')) await control.selectOption(value)
        else await control.fill(value)
      }
      const before = await snapshot()
      const path = `${origin}/api/${item.operation}`
      const requests = []
      const observe = (request) => {
        if (request.url() === path && request.method() === 'POST') {
          const body = request.postDataJSON()
          if (item.operation !== 'prospects/import' || body.commit) requests.push({ key: request.headers()['idempotency-key'], body })
          else assert.equal(request.headers()['idempotency-key'], undefined, 'Preview must not consume a key')
        }
      }
      page.on('request', observe)
      let committed
      const abort = async (route) => {
        if (route.request().method() !== 'POST' || (item.operation === 'prospects/import' && !route.request().postDataJSON().commit)) return route.continue()
        const response = await route.fetch()
        assert.equal(response.status(), item.operation === 'prospects/import' ? 200 : 201)
        committed = await response.json()
        assert.equal(committed.replayed, false)
        await route.abort('failed')
      }
      const submit = dialog.getByRole('button', { name: t(item.submit), exact: true })
      const capture = async (state) => {
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(({ id }) => id))
        assert.deepEqual(violations, [])
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        scans++
        await page.screenshot({ path: join(screenshots, `simbi-creation-retry-${item.operation.replace('/', '-')}-${locale}-${state}.png`), fullPage: false })
      }
      try {
        expectFailure(path, 'abort')
        await page.route(path, abort)
        await submit.click()
        await dialog.getByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'), { exact: true }).waitFor()
        await page.unroute(path, abort)
        expectFailure('', '')
        assert.equal(requests.length, 1)
        assert.equal(committed.creation_key, requests[0].key)
        assert.match(requests[0].key, /^[a-f0-9-]{36}$/)
        for (const [name, value] of Object.entries(values)) assert.equal(await dialog.locator(`[name=${name}]`).inputValue(), value)
        const afterCommit = await snapshot()
        const table = item.operation === 'prospects/import' ? 'prospects' : item.operation
        assert.equal(afterCommit[table].length, before[table].length + 1)
        assert.equal(afterCommit.audit_events.length, before.audit_events.length + 1)
        for (const table of tables) {
          const idsBefore = new Set(before[table].map((row) => row.id))
          const retained = afterCommit[table].filter((row) => idsBefore.has(row.id))
          if (item.operation === 'replies' && table === 'drafts') {
            assert.deepEqual(retained.filter((row) => row.id !== ids.drafts), before[table].filter((row) => row.id !== ids.drafts))
            assert.equal(retained.find((row) => row.id === ids.drafts).state, 'replied')
          } else assert.deepEqual(retained, before[table], `Creation changed prior ${table}`)
        }
        await capture('uncertain')
        const changed = dialog.locator(`[name=${item.changed}]`)
        if (item.operation === 'drafts') {
          const options = await changed.locator('option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean))
          const another = options.find((id) => id !== values.template_id)
          assert.ok(another, 'Retained workflows must provide another real template')
          await changed.selectOption(another)
        } else await changed.fill(item.operation === 'prospects/import' ? values.csv_text.replace('Fictional reviewed local CSV', 'Different fictional CSV context') : `${values[item.changed]} changed`)
        expectFailure(path, 'conflict')
        const conflict = page.waitForResponse((response) => response.url() === path && response.request().method() === 'POST' && (item.operation !== 'prospects/import' || response.request().postDataJSON().commit))
        await submit.click()
        assert.equal((await conflict).status(), 409)
        await dialog.getByText(t('This retry reference belongs to different submitted values or a different creation. Check the saved records or retry the original values; nothing new was created.'), { exact: true }).waitFor()
        expectFailure('', '')
        assert.equal(requests.length, 2)
        const afterConflict = await snapshot()
        for (const table of tables) assert.deepEqual(afterConflict[table], afterCommit[table])
        if (item.operation === 'drafts') await changed.selectOption(values[item.changed])
        else await changed.fill(values[item.changed])
        const replay = page.waitForResponse((response) => response.url() === path && response.request().method() === 'POST' && (item.operation !== 'prospects/import' || response.request().postDataJSON().commit))
        await submit.click()
        const recovered = await replay
        assert.equal(recovered.status(), item.operation === 'prospects/import' ? 200 : 201)
        assert.deepEqual(await recovered.json(), { ...committed, replayed: true })
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(requests.length, 3)
        assert.ok(requests.every((request) => request.key === requests[0].key))
        assert.deepEqual(requests[2].body, requests[0].body)
        const afterReplay = await snapshot()
        for (const table of tables) assert.deepEqual(afterReplay[table], afterCommit[table], `Replay changed ${table}`)
        if (item.operation !== 'prospects/import') ids[item.operation] = committed.id
        await capture('recovered')
        process.stdout.write(`Creation recovery ${locale}/${item.operation}: real commit/abort, changed-values 409, original same-key confirmation, no replay mutation.\n`)
      } finally {
        expectFailure('', '')
        await page.unroute(path, abort)
        page.off('request', observe)
      }
      if (item.operation === 'campaigns') {
        const row = page.locator('.resource-row').filter({ hasText: names.campaign })
        await row.getByRole('button', { name: t('Activate'), exact: true }).click()
        await row.getByRole('button', { name: t('Pause'), exact: true }).waitFor()
      }
      if (item.operation === 'drafts') {
        await page.locator('.review-item').filter({ hasText: names.prospect }).click()
        for (const checkbox of await page.locator('.approval-box input[type=checkbox]').all()) await checkbox.check()
        await page.getByRole('button', { name: t('Approve for handoff'), exact: true }).click()
        await page.getByRole('button', { name: t('Copy and open provider'), exact: true }).click()
        const handoff = page.getByRole('dialog', { name: t('Manual provider handoff'), exact: true })
        // Record isolated local uncertainty without opening a provider.
        await handoff.getByRole('button', { name: t('Unsure — needs verification'), exact: true }).click()
        await handoff.waitFor({ state: 'hidden' })
      }
    }
  }
  assert.equal(scans, 24)
}
