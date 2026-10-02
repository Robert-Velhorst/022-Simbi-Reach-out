import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, choose, enter } from './e2e-keyboard-controls.mjs'

// Actual local commits with damaged confirmations, never provider operations.
export async function safetyMutationsWorkflow(page, origin, axe, screenshots) {
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const before = await snapshot()
  let scans = 0, writes = 0
  const observe = request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes++ }
  page.on('request', observe)
  try {
    for (const locale of ['en', 'nl']) {
      const catalog = JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))
      const t = key => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} safety label`); return catalog[key] }
      const button = key => page.getByRole('button', { name: t(key), exact: true })
      await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
      await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
      await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
      await page.getByRole('heading', { name: t('Settings & safety'), exact: true }).waitFor()
      const capture = async state => {
        assert.equal(new URL(page.url()).pathname, '/settings')
        assert.ok((await page.title()).includes('Simbi'))
        assert.ok((await page.locator('main').textContent()).trim())
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id }) => id))
        assert.deepEqual(violations, [], `${locale}/${state}`)
        scans++
        await page.screenshot({ path: join(screenshots, `simbi-safety-mutation-${locale}-${state}.png`), fullPage: false })
      }
      const tasks = [
        { path: 'compliance', control: 'Record acknowledgement', success: 'Compliance acknowledgement recorded in the audit log.', prepare: async () => {
          for (const name of ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process']) {
            const box = page.locator(`input[name="${name}"]`)
            if (!await box.isChecked()) await activate(page, box, 'Space')
          }
        } },
        { path: 'provider', control: 'Save assisted provider', success: 'Provider link saved. Assisted mode remains enforced.', prepare: async () => {
          await enter(page, page.getByRole('textbox', { name: t('HTTPS base URL'), exact: true }), 'https://simbi.com/services#fictional-safety-test')
        } },
        { path: 'pause', control: 'Enable safety stop', success: 'Safety stop enabled. New approvals and handoffs are blocked.', prepare: async () => {} },
      ]
      for (const task of tasks) {
        await task.prepare()
        const match = `${origin}/api/settings/${task.path}`
        let calls = 0
        const handler = async route => {
          assert.equal(route.request().method(), 'POST'); calls++
          const actual = await route.fetch(); assert.equal(actual.status(), 200)
          await route.fulfill({ response: actual, json: {} })
        }
        await page.route(match, handler)
        try {
          await activate(page, button(task.control))
          await page.getByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'), { exact: true }).waitFor()
          assert.equal(await page.getByText(t(task.success), { exact: true }).count(), 0)
          assert.equal(await page.getByText(t('The workspace is operating under its normal approval gates.'), { exact: true }).count(), 0)
          await page.getByText(t('Safety settings may have changed. Refresh Settings before another safety change.'), { exact: true }).waitFor()
          assert.equal(await button('Record acknowledgement').isEnabled(), false)
          assert.equal(await button('Save assisted provider').isEnabled(), false)
          assert.equal(await button('Enable safety stop').isEnabled(), false)
          assert.equal(calls, 1, 'No automatic write retry')
          await capture(`${task.path}-unverified`)
        } finally { await page.unroute(match, handler) }
        const writesBeforeRead = writes
        await activate(page, button('Refresh'))
        const current = await page.request.get(`${origin}/api/settings`)
        assert.equal(current.status(), 200)
        const settings = await current.json()
        if (task.path === 'compliance') assert.ok(settings.workspace.compliance_ack_at)
        if (task.path === 'provider') assert.equal(settings.providers.find(item => item.provider === 'simbi').base_url, 'https://simbi.com/services')
        if (task.path === 'pause') { assert.ok(settings.workspace.paused_at); await button('Resume guarded workflow').waitFor() }
        await page.waitForLoadState('networkidle')
        assert.equal(writes, writesBeforeRead, 'Explicit recovery read cannot repeat a write')
        await capture(`${task.path}-read-recovered`)
        if (task.path === 'pause') {
          await activate(page, button('Resume guarded workflow'))
          await page.getByText(t('Workspace resumed. Existing review gates still apply.'), { exact: true }).waitFor()
        } else {
          await activate(page, button(task.control))
          await page.getByText(t(task.success), { exact: true }).waitFor()
        }
        await capture(`${task.path}-confirmed`)
      }
      process.stdout.write(`Safety mutations ${locale}: three actual committed/damaged confirmations rejected; explicit read-only recovery; three verified confirmations.\n`)
    }
    assert.equal(scans, 18); assert.equal(writes, 12)
    const after = await snapshot()
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) assert.deepEqual(after[table], before[table], `Safety checks changed ${table}`)
    assert.equal(after.audit_events.length, before.audit_events.length + 12)
    for (const previous of before.audit_events) assert.deepEqual(after.audit_events.find(item => item.id === previous.id), previous)
  } finally { page.off('request', observe) }
}
