import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, choose } from './e2e-keyboard-controls.mjs'

// Corrupt one consumed field of an actual successful GET, not fixture storage.
// Recover only through native keyboard Retry/Try again; never provider activity.
export async function operationalReadsWorkflow(page, origin, axe, screenshots) {
  const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const before = await snapshot()
  const writes = []
  const observe = request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method()) }
  page.on('request', observe)
  let scans = 0
  try {
    for (const locale of ['en', 'nl']) {
      const catalog = JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))
      const t = key => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} operational label: ${key}`); return catalog[key] }
      await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
      await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
      const cases = [
        { resource: 'overview', route: '/', rows: '.safety-strip', damage: value => ({ ...value, safety: { ...value.safety, paused: 'false' } }) },
        { resource: 'reports/summary', route: '/reports', rows: '.metric-rail', damage: value => ({ ...value, funnel: { ...value.funnel, total: { fictional: 'Damaged read only' } } }) },
        { resource: 'settings', route: '/settings', rows: '.settings-grid', damage: value => ({ ...value, workspace: { ...value.workspace, name: { fictional: 'Damaged read only' } } }) },
        { resource: 'auth/status', route: '/', boot: true, damage: value => ({ ...value, setup_required: 'false' }) },
        { resource: 'me', route: '/', boot: true, damage: value => ({ ...value, role: 'unverified-role' }) },
      ]
      for (const item of cases) {
        const match = `${origin}/api/${item.resource}`
        let reads = 0
        let original
        const handler = async route => {
          assert.equal(route.request().method(), 'GET')
          reads++
          if (reads !== 1) return route.continue()
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          original = await response.json()
          await route.fulfill({ response, json: item.damage(original) })
        }
        const capture = async state => {
          assert.equal(new URL(page.url()).pathname, item.route)
          assert.ok((await page.title()).includes('Simbi'))
          assert.ok((await page.locator('main').textContent()).trim())
          assert.equal(await page.locator('vite-error-overlay').count(), 0)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          if (state.startsWith('recovered') && (item.resource === 'overview' || item.boot)) {
            const safety = page.getByRole('region', { name: t('Safety and compliance status') })
            for (const key of ['Local only', 'Provider guidance', 'Policy review', 'Emergency safety stop']) assert.ok(await safety.getByText(t(key), { exact: true }).isVisible(), `${locale}/${state}/${key} must remain visible`)
          }
          await page.addScriptTag({ content: axe.source })
          const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(({ id }) => id))
          assert.deepEqual(violations, [], `${locale}/${item.resource}/${state}`)
          scans++
          await page.screenshot({ path: join(screenshots, `simbi-operational-read-${item.resource.replaceAll('/', '-')}-${locale}-${state}.png`), fullPage: false })
        }
        await page.route(match, handler)
        try {
          await page.goto(`${origin}${item.route}`, { waitUntil: 'networkidle' })
          const warning = page.getByText(t('The local service returned an unverified operational response. Retry only this read; do not reload or repeat a change. No result was verified.'), { exact: true })
          await warning.waitFor()
          assert.equal(reads, 1, 'No automatic operational read retry')
          if (item.boot) {
            await page.getByRole('heading', { name: t('Service unavailable'), exact: true }).waitFor()
            assert.equal(await page.getByRole('button', { name: t('Sign in'), exact: true }).count(), 0)
            assert.equal(await page.getByRole('button', { name: t('Create workspace'), exact: true }).count(), 0)
            assert.equal(await page.locator('.dashboard-grid').count(), 0)
          } else {
            assert.equal(await page.locator(item.rows).count(), 0, 'No damaged operational result renders')
          }
          await capture('unverified')
          await activate(page, page.getByRole('button', { name: t(item.boot ? 'Try again' : 'Retry'), exact: true }))
          await warning.waitFor({ state: 'hidden' })
          await page.locator(item.boot ? '.safety-strip' : item.rows).waitFor()
          assert.equal(reads, 2, 'Exactly one explicit operational read retry')
          if (item.resource === 'overview' || item.boot) {
            await page.getByText(t('Last verified local status, not backup, privacy or provider-policy certification.'), { exact: true }).waitFor()
            assert.equal(await page.getByText(t('SQLite + backups'), { exact: true }).count(), 0)
            assert.equal(await page.getByText(t('On-device only'), { exact: true }).count(), 0)
          }
          if (item.resource === 'settings') assert.ok((await page.locator('.settings-grid').textContent()).includes(original.environment))
          await capture('recovered')
          if (item.resource === 'overview') {
            await page.setViewportSize({ width: 1100, height: 1000 })
            await capture('recovered-medium')
            await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
            assert.equal(reads, 2, 'Responsive safety checks must not trigger another read')
          }
          process.stdout.write(`Operational read ${locale}/${item.resource}: damaged actual200 rejected, native explicit retry recovers actual local result, no automatic retry or writes.\n`)
        } finally { await page.unroute(match, handler) }
      }
    }
    assert.equal(scans, 22)
    assert.deepEqual(writes, [])
    const after = await snapshot()
    for (const table of tables) assert.deepEqual(after[table], before[table], `Operational read changed ${table}`)
  } finally { page.off('request', observe) }
}
