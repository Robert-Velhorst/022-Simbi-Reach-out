import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, choose } from './e2e-keyboard-controls.mjs'

// Damage a successful actual read, never stored rows or a write response.
// Native keyboard Retry must recover the real records without automatic reads,
// navigation, mutations, provider contact or private working-copy storage.
export async function pageRecordsWorkflow(page, origin, axe, screenshots) {
  const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const before = await snapshot()
  const cases = [
    { resource: 'campaigns', route: '/campaigns', heading: 'Campaigns', field: 'name', rows: '.resource-row', label: row => row.name },
    { resource: 'prospects', route: '/prospects', heading: 'Prospects', field: 'name', rows: 'tbody tr', label: row => row.name },
    { resource: 'templates', route: '/templates', heading: 'Templates', field: 'body', rows: '.template-item', label: row => row.name },
    { resource: 'drafts', route: '/review', heading: 'Review queue', field: 'safety_flags', rows: '.review-item', label: row => row.prospect_name },
    { resource: 'replies', route: '/replies', heading: 'Replies', field: 'body', rows: '.conversation-list article', label: row => row.prospect_name },
    { resource: 'reminders', route: '/reminders', heading: 'Reminders', field: 'title', rows: '.task-list article', label: row => row.title },
    { resource: 'audit', route: '/audit', heading: 'Audit log', field: 'entity_type', rows: 'tbody tr', label: (row, t) => t(row.event_type.replaceAll('.', ' ').replaceAll('_', ' ')) },
  ]
  const writes = []
  const observe = request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method()) }
  page.on('request', observe)
  let scans = 0
  try {
    for (const locale of ['en', 'nl']) {
      const catalog = JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))
      const t = key => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} read label: ${key}`); return catalog[key] }
      await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
      await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
      for (const item of cases) {
        const match = new RegExp(`^${origin.replaceAll('.', '\\.').replaceAll(':', '\\:')}/api/${item.resource}(?:\\?.*)?$`)
        let reads = 0
        let damaged = 0
        let original
        const handler = async route => {
          assert.equal(route.request().method(), 'GET')
          reads++
          if (damaged) return route.continue()
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          original = await response.json()
          assert.ok(original.items.length > 0, `Real ${item.resource} records are required`)
          damaged++
          await route.fulfill({ response, json: { ...original, items: [{ ...original.items[0], [item.field]: { fictional: 'Unverified local read only' } }, ...original.items.slice(1)] } })
        }
        const capture = async state => {
          assert.equal(new URL(page.url()).pathname, item.route)
          assert.ok((await page.title()).includes('Simbi'))
          assert.ok((await page.locator('main').textContent()).trim())
          assert.equal(await page.locator('vite-error-overlay').count(), 0)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          await page.addScriptTag({ content: axe.source })
          const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(({ id }) => id))
          assert.deepEqual(violations, [], `${locale}/${item.resource}/${state}`)
          scans++
          await page.screenshot({ path: join(screenshots, `simbi-record-read-${item.resource}-${locale}-${state}.png`), fullPage: false })
        }
        await page.route(match, handler)
        try {
          await page.goto(`${origin}${item.route}`, { waitUntil: 'networkidle' })
          await page.getByRole('heading', { name: t(item.heading), exact: true }).waitFor()
          const warning = page.getByText(t('The local service returned an unverified record list. Retry this read without reloading or resubmitting a change; no result was verified.'), { exact: true })
          await warning.waitFor()
          assert.equal(reads, 1, 'No automatic read retry')
          assert.equal(damaged, 1)
          assert.equal(await page.locator(item.rows).count(), 0, 'Damaged rows must not render')
          await capture('unverified')
          await activate(page, page.getByRole('button', { name: t('Retry'), exact: true }))
          await page.locator(item.rows).first().waitFor()
          await warning.waitFor({ state: 'hidden' })
          assert.equal(reads, 2, 'Exactly one explicit read retry')
          assert.ok((await page.locator(item.rows).first().textContent()).includes(item.label(original.items[0], t)))
          await capture('recovered')
          process.stdout.write(`Record read ${locale}/${item.resource}: damaged actual200 rejected, native keyboard retry recovers real rows, no automatic retry or writes.\n`)
        } finally { await page.unroute(match, handler) }
      }
    }
    assert.equal(scans, 28)
    assert.deepEqual(writes, [])
    const after = await snapshot()
    for (const table of tables) assert.deepEqual(after[table], before[table], `Record read changed ${table}`)
  } finally { page.off('request', observe) }
}
