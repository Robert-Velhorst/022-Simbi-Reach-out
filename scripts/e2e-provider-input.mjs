import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, choose, enter } from './e2e-keyboard-controls.mjs'

// Readback damage applies only to actual local responses; no provider access.
export async function providerInputRecoveryWorkflow(page, origin, axe, screenshots) {
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const before = await snapshot()
  let scans = 0, writes = 0
  const bodies = []
  const observe = request => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return
    writes++
    assert.equal(request.url(), `${origin}/api/settings/provider`)
    bodies.push(request.postDataJSON())
  }
  page.on('request', observe)
  const expectedBodies = []
  try {
    for (const locale of ['en', 'nl']) {
      const catalog = JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))
      const t = (key, params = {}) => {
        assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} provider-input label`)
        return catalog[key].replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name) => Object.hasOwn(params, name) ? String(params[name]) : placeholder)
      }
      const button = key => page.getByRole('button', { name: t(key), exact: true })
      const workingNotice = 'Your provider edits are kept on this page. Refresh only reads saved settings; it does not save these edits.'
      const warning = 'Safety settings may have changed. Refresh Settings before another safety change.'
      const savedNotice = 'Provider link saved. Assisted mode remains enforced.'
      await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
      await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
      await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
      await page.getByRole('heading', { name: t('Settings & safety'), exact: true }).waitFor()
      const capture = async state => {
        assert.equal(new URL(page.url()).pathname, '/settings')
        assert.ok((await page.title()).includes('Simbi'))
        assert.ok((await page.locator('main').textContent()).trim())
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        if (state !== 'entry') await button('Save assisted provider').scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(screenshots, `simbi-provider-input-${locale}-${state}.png`), fullPage: false })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}/${state} horizontal overflow`)
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id }) => id))
        assert.deepEqual(violations, [], `${locale}/${state}`)
        scans++
      }
      await capture('entry')
      const input = page.getByRole('textbox', { name: t('HTTPS base URL'), exact: true })
      const providerInput = page.getByRole('textbox', { name: t('Provider'), exact: true })
      const originalInput = await input.elementHandle()
      const originalProvider = await providerInput.elementHandle()
      const normalized = `https://simbi.com/provider-working-copy-${locale}?value=${'x'.repeat(160)}`
      const typed = `${normalized}#keep-original`
      const conflicting = `https://simbi.com/contradictory-snapshot-${locale}?value=${'y'.repeat(160)}`
      await enter(page, providerInput, 'Simbi')
      await enter(page, input, typed)
      let damage = 'contradictory'
      const handler = async route => {
        assert.equal(route.request().method(), 'GET')
        const actual = await route.fetch()
        assert.equal(actual.status(), 200)
        const value = await actual.json()
        if (damage === 'malformed') value.workspace = null
        else if (damage === 'duplicate') {
          const correct = value.providers.find(item => item.provider === 'simbi')
          const contradictory = { ...correct, base_url: conflicting }
          value.providers = locale === 'en' ? [contradictory, ...value.providers] : [...value.providers, contradictory]
        }
        else value.providers.find(item => item.provider === 'simbi').base_url = conflicting
        await route.fulfill({ response: actual, json: value })
      }
      const assertWorking = async () => {
        assert.equal(await originalInput.evaluate(element => element.isConnected), true)
        assert.equal(await originalProvider.evaluate(element => element.isConnected), true)
        assert.equal(await input.inputValue(), typed)
        assert.equal(await providerInput.inputValue(), 'Simbi')
        await page.getByText(t(workingNotice), { exact: true }).waitFor()
      }
      const assertUncertain = async () => {
        await assertWorking()
        await page.getByText(t(warning), { exact: true }).waitFor()
        assert.equal(await page.getByText(t(savedNotice), { exact: true }).count(), 0)
        assert.equal(await page.getByText(t('The workspace is operating under its normal approval gates.'), { exact: true }).count(), 0)
        for (const control of ['Record acknowledgement', 'Save assisted provider', 'Enable safety stop']) assert.equal(await button(control).isEnabled(), false)
      }
      const startWrites = writes
      await page.route(`${origin}/api/settings`, handler)
      try {
        await activate(page, button('Refresh'))
        await page.getByText(t('Last loaded provider: {provider} — {url}.', { provider: 'simbi', url: conflicting }), { exact: true }).waitFor()
        await assertWorking()
        assert.equal(writes, startWrites, 'Refresh must not save working edits')
        await page.getByRole('heading', { name: t('Provider handoff'), exact: true }).scrollIntoViewIfNeeded()
        await capture('refresh-preserved')
        await activate(page, button('Save assisted provider'))
        await page.getByText(t('Settings could not be verified. Retry the settings read before repeating a change; the earlier change may already be saved.'), { exact: true }).waitFor()
        await assertUncertain()
        assert.equal(writes, startWrites + 1)
        await capture('contradictory-readback')
        const stored = await page.request.get(`${origin}/api/settings`)
        assert.equal(stored.status(), 200)
        assert.equal((await stored.json()).providers.find(item => item.provider === 'simbi').base_url, normalized)
        damage = 'malformed'
        await activate(page, button('Refresh'))
        await button('Retry').waitFor()
        await assertUncertain()
        assert.equal(writes, startWrites + 1, 'A failed recovery read cannot repeat the write')
        await capture('failed-recovery')
      } finally { await page.unroute(`${origin}/api/settings`, handler) }
      await activate(page, button('Retry'))
      await page.getByText(t('Last loaded provider: {provider} — {url}.', { provider: 'simbi', url: normalized }), { exact: true }).waitFor()
      await assertWorking()
      assert.equal(await button('Save assisted provider').isEnabled(), true)
      assert.equal(writes, startWrites + 1, 'A successful recovery read cannot repeat the write')
      await page.getByRole('heading', { name: t('Provider handoff'), exact: true }).scrollIntoViewIfNeeded()
      await capture('read-recovered')
      await activate(page, button('Save assisted provider'))
      await page.getByText(t(savedNotice), { exact: true }).waitFor()
      assert.equal(await originalInput.evaluate(element => element.isConnected), true)
      assert.equal(await input.inputValue(), normalized)
      assert.equal(await providerInput.inputValue(), 'simbi')
      assert.equal(await page.getByText(t(workingNotice), { exact: true }).count(), 0)
      assert.equal(writes, startWrites + 2)
      await capture('confirmed')
      // A receipt must not be confirmed by an ambiguous Settings list, in either
      // row order. The same damaged list must not unlock a recovery read either.
      await enter(page, providerInput, 'Simbi')
      await enter(page, input, typed)
      damage = 'duplicate'
      await page.route(`${origin}/api/settings`, handler)
      try {
        await activate(page, button('Save assisted provider'))
        await button('Retry').waitFor()
        await assertUncertain()
        assert.equal(writes, startWrites + 3)
        await activate(page, button('Refresh'))
        await button('Retry').waitFor()
        await assertUncertain()
        assert.equal(writes, startWrites + 3, 'Duplicate recovery data cannot repeat or confirm a write')
        await capture('duplicate-readback')
      } finally { await page.unroute(`${origin}/api/settings`, handler) }
      await activate(page, button('Retry'))
      // The normalized caption is already present from the preceding save;
      // observing it alone does not prove this recovery read has finished.
      await page.waitForFunction(control => !control.disabled, await button('Save assisted provider').elementHandle())
      await page.getByText(t('Last loaded provider: {provider} — {url}.', { provider: 'simbi', url: normalized }), { exact: true }).waitFor()
      await assertWorking()
      assert.equal(await button('Save assisted provider').isEnabled(), true)
      assert.equal(await page.getByText(t(savedNotice), { exact: true }).count(), 0)
      assert.equal(writes, startWrites + 3)
      await capture('duplicate-recovered')
      expectedBodies.push(...Array.from({ length: 3 }, () => ({ provider: 'Simbi', base_url: typed })))
      process.stdout.write(`Provider input ${locale}: original fields retained through contradictory, duplicate and failed/successful reads; explicit verified save normalizes without remount; three deliberate local writes.\n`)
    }
    assert.equal(scans, 16); assert.equal(writes, 6)
    assert.deepEqual(bodies, expectedBodies)
    const after = await snapshot()
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) assert.deepEqual(after[table], before[table], `Provider recovery changed ${table}`)
    assert.equal(after.audit_events.length, before.audit_events.length + 6)
    for (const previous of before.audit_events) assert.deepEqual(after.audit_events.find(item => item.id === previous.id), previous)
  } finally { page.off('request', observe) }
}
