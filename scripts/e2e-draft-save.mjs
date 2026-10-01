import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))
const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']

// Fictional owner records only. Both editors are real same-account browser tabs.
// Context-level external-request blocking is supplied by the full harness.
export async function draftSaveWorkflow(owner, origin, axe, screenshots) {
  const context = owner.context()
  const csrf = (await context.cookies(origin)).find((cookie) => cookie.name === 'simbi_csrf')?.value
  assert.ok(csrf)
  const create = async (path, data) => {
    const result = await owner.request.post(`${origin}/api/${path}`, { headers: { 'X-CSRF-Token': csrf }, data })
    assert.ok(result.ok(), `${path}: ${result.status()}`)
    return result.json()
  }
  const snapshot = async () => {
    const result = await owner.request.get(`${origin}/api/export`)
    assert.ok(result.ok())
    const data = await result.json()
    return Object.fromEntries(tables.map((table) => { assert.ok(Array.isArray(data[table])); return [table, data[table]] }))
  }
  let totalScans = 0
  for (const locale of ['en', 'nl']) {
    const t = (key) => { assert.ok(Object.hasOwn(catalogs[locale], key), `Missing draft-save key: ${key}`); return catalogs[locale][key] }
    const campaign = await create('campaigns', { name: `Save conflict fixture ${locale}`, purpose: 'Fictional isolated two-tab acceptance only.', lawful_basis: 'No real person or provider operation.' })
    const prospect = await create('prospects', { name: `Save conflict person ${locale}`, source_url: `https://simbi.com/never-send-save-conflict-${locale}`, consent_status: 'consented' })
    const template = await create('templates', { name: `Save conflict template ${locale}`, subject: 'Fictional original subject', body: 'Hello {name}, this is a fictional local draft for {campaign}. No thanks is fine; this text must never be sent.' })
    const draft = await create('drafts', { campaign_id: campaign.id, prospect_id: prospect.id, template_id: template.id })
    const path = `${origin}/api/drafts/${draft.id}`
    const current = async () => { const result = await owner.request.get(path); assert.ok(result.ok()); return result.json() }
    const first = await context.newPage()
    const second = await context.newPage()
    const errors = []
    let expectedConflict = false
    let expectedAbort = false
    let conflicts = 0
    let aborted = 0
    let writes = 0
    for (const page of [first, second]) {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        const atSave = message.location().url === path
        if (atSave && expectedConflict && message.text().includes('409')) return
        if (atSave && expectedAbort && /ERR_FAILED|Load failed|NetworkError|Failed to load/i.test(message.text())) return
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('response', (response) => { if (response.url() === path && response.request().method() === 'PATCH' && response.status() === 409) conflicts++ })
      page.on('requestfailed', (request) => { if (expectedAbort && request.url() === path && request.method() === 'PATCH') aborted++ })
      page.on('request', (request) => {
        if (!request.url().startsWith(`${origin}/api/`) || ['GET', 'HEAD'].includes(request.method())) return
        assert.equal(request.method(), 'PATCH', 'Draft comparison must not approve, hand off or perform other writes')
        assert.equal(request.url(), path)
        writes++
      })
    }
    const button = (page, key) => page.getByRole('button', { name: t(key), exact: true })
    const save = async (page, status) => {
      const result = page.waitForResponse((response) => response.url() === path && response.request().method() === 'PATCH' && response.status() === status)
      await button(page, 'Save and return to review').click()
      const response = await result
      if (status === 409) assert.equal((await response.json()).error.code, 'draft_save_conflict')
    }
    const compare = async () => {
      await button(second, 'Check saved version').click()
      const dialog = second.getByRole('dialog', { name: t('Compare saved draft') })
      await dialog.waitFor()
      return dialog
    }
    try {
      for (const page of [first, second]) {
        await page.goto(`${origin}/review`, { waitUntil: 'networkidle' })
        await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
        await page.locator('.review-item').filter({ hasText: `Save conflict person ${locale}` }).click()
        assert.ok((await page.title()).includes('Simbi'))
        await page.getByRole('heading', { name: t('Review queue'), exact: true }).waitFor()
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
      }
      const initial = await current()
      const localBody = `Fictional local edits ${locale}: $& {name}. These words must survive a conflicting save; never send them.`
      await second.locator('[name=body]').fill(localBody)
      await first.locator('[name=subject]').fill(`Newer first-tab saved subject ${locale}`)
      await save(first, 200)
      const winner = await current()
      assert.notEqual(winner.edit_version, initial.edit_version)
      const beforeConflict = await snapshot()
      expectedConflict = true
      await save(second, 409)
      await second.getByText(t('The saved draft changed. Your unsaved edits remain here. Compare the saved version before saving.')).waitFor()
      assert.equal(await second.locator('[name=body]').inputValue(), localBody)
      assert.deepEqual(await snapshot(), beforeConflict, 'Rejected stale save must not change any stored table')
      expectedConflict = false
      let dialog = await compare()
      assert.equal(await dialog.getByLabel(t('Saved subject'), { exact: true }).inputValue(), winner.subject)
      assert.equal(await dialog.getByLabel(t('Unsaved message'), { exact: true }).inputValue(), localBody)
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await second.setViewportSize(viewport)
        await second.addScriptTag({ content: axe.source })
        const scan = await second.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
        assert.deepEqual(scan.violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) })), [])
        totalScans++
        const bounds = await dialog.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, scroll: element.scrollWidth, client: element.clientWidth } })
        process.stdout.write(`Draft comparison geometry: ${locale}, ${viewport.width}x${viewport.height}, ${JSON.stringify(bounds)}\n`)
        // Gecko represents the flush bottom edge as844.000015 in an844px viewport.
        // Allow only floating-point rounding, not a CSS pixel of real overflow.
        const rounding = 0.001
        assert.ok(bounds.left >= -rounding && bounds.right <= bounds.width + rounding && bounds.top >= -rounding && bounds.bottom <= bounds.height + rounding, JSON.stringify(bounds))
        assert.ok(bounds.scroll <= bounds.client + 1, 'Comparison must not cause horizontal overflow')
        await second.screenshot({ path: join(screenshots, `simbi-draft-save-${locale}-${viewport.width === 390 ? 'mobile' : 'desktop'}.png`), fullPage: false })
      }
      const close = dialog.getByRole('button', { name: t('Close'), exact: true })
      const last = dialog.getByRole('button', { name: t('Keep my edits for a new review'), exact: true })
      await close.focus(); await second.keyboard.press('Shift+Tab')
      assert.ok(await last.evaluate((element) => element === document.activeElement))
      await second.keyboard.press('Tab')
      assert.ok(await close.evaluate((element) => element === document.activeElement))
      await second.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      assert.ok(await button(second, 'Check saved version').evaluate((element) => element === document.activeElement))
      assert.equal(await second.locator('[name=body]').inputValue(), localBody)
      assert.deepEqual(await snapshot(), beforeConflict, 'Comparison and Escape must not write')
      dialog = await compare()
      await dialog.getByRole('button', { name: t('Keep my edits for a new review'), exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.deepEqual(await snapshot(), beforeConflict, 'Retaining edits must not implicitly save')
      assert.ok(await second.locator('.draft-editor').evaluate((element) => element === document.activeElement))

      // A further change after comparison must still reject, never overwrite.
      await first.locator('[name=subject]').fill(`Changed after comparison ${locale}`)
      await save(first, 200)
      const beforeSecondConflict = await snapshot()
      expectedConflict = true
      await save(second, 409)
      await button(second, 'Check saved version').waitFor()
      assert.deepEqual(await snapshot(), beforeSecondConflict)
      expectedConflict = false
      dialog = await compare()
      await dialog.getByRole('button', { name: t('Keep my edits for a new review'), exact: true }).click()
      await save(second, 200)
      await second.waitForFunction(() => document.querySelector('.draft-editor button')?.disabled === true)
      assert.equal((await current()).body, localBody)
      assert.equal((await current()).state, 'needs_review')
      assert.equal(await second.locator('.approval-box input:checked').count(), 0)

      // English substitutes a mismatched successful response; Dutch really
      // aborts the committed response. Neither implies failure or auto-retries.
      const uncertainBody = `${localBody} Changed once more for interrupted-response acceptance.`
      let committed = 0
      await second.route(path, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        const result = await route.fetch()
        assert.ok(result.ok())
        committed++
        if (locale === 'nl') return route.abort('failed')
        const saved = await result.json()
        return route.fulfill({ response: result, json: { ...saved, body: 'Deliberately mismatched fictional response' } })
      })
      await second.locator('[name=body]').fill(uncertainBody)
      expectedAbort = locale === 'nl'
      await button(second, 'Save and return to review').click()
      await second.getByText(t('The save result could not be verified. Keep your edits and check the saved version.')).waitFor()
      assert.equal(committed, 1)
      assert.equal(await second.locator('[name=body]').inputValue(), uncertainBody)
      assert.equal((await current()).body, uncertainBody)
      assert.equal(aborted, locale === 'nl' ? 1 : 0)
      expectedAbort = false
      await second.unroute(path)
      const beforeRecovery = await snapshot()
      dialog = await compare()
      await dialog.getByRole('button', { name: t('Use verified saved version'), exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await second.locator('[name=body]').inputValue(), uncertainBody)
      assert.deepEqual(await snapshot(), beforeRecovery, 'Readback recovery must not duplicate the committed save')
      assert.equal(conflicts, 2)
      assert.equal(writes, 6, 'Four deliberate changes and two rejected saves only')
      assert.deepEqual(errors, [])
      const stored = await second.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)])
      assert.ok(stored.every((value) => !value.includes(localBody)), 'Unsaved message content must not be stored in the browser')
      process.stdout.write(`Draft save: ${locale}, real sibling tabs, two rejected stale versions, explicit no-write comparison/rebase/cancel, four changes, verified uncertain-response readback without duplicate writes; aborts=${aborted}; browser errors=0.\n`)
    } finally { await first.close(); await second.close() }
  }
  assert.equal(totalScans, 4)
  await owner.setViewportSize({ width: 1440, height: 1000 })
  await owner.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
}
