import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events']
const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

// Actual fictional local commits, not fake success or provider activity.
export async function reminderReplayWorkflow(page, origin, axe, screenshots, expectFailure) {
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.ok(response.ok())
    return response.json()
  }
  let scans = 0
  for (const locale of ['en', 'nl']) {
    const t = (key) => { assert.ok(Object.hasOwn(catalogs[locale], key)); return catalogs[locale][key] }
    const before = await snapshot()
    await page.setViewportSize(locale === 'en' ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
    await page.goto(`${origin}/reminders`, { waitUntil: 'networkidle' })
    assert.equal(new URL(page.url()).pathname, '/reminders')
    assert.ok((await page.title()).includes('Simbi'))
    await page.getByRole('heading', { name: t('Reminders'), exact: true }).waitFor()
    await page.getByRole('button', { name: t('New reminder'), exact: true }).click()
    const dialog = page.getByRole('dialog', { name: t('Create reminder'), exact: true })
    const conversation = dialog.locator('[name=draft_id]')
    await conversation.locator('option').nth(1).waitFor({ state: 'attached' })
    await conversation.selectOption(await conversation.locator('option').nth(1).getAttribute('value'))
    const title = `Fictional interrupted reminder ${locale}`
    await dialog.getByLabel(t('Reminder'), { exact: true }).fill(title)
    await dialog.getByRole('checkbox', { name: t('Enter date and time as text'), exact: true }).check()
    await dialog.getByLabel(t('Due'), { exact: true }).fill('2027-11-02T07:58')
    const submit = dialog.getByRole('button', { name: t('Create reminder'), exact: true })
    const path = `${origin}/api/reminders`
    const requests = []
    const observe = (request) => {
      if (request.url() === path && request.method() === 'POST') requests.push({ key: request.headers()['idempotency-key'], body: request.postData() })
    }
    page.on('request', observe)
    let committed
    const abort = async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      assert.equal(response.status(), 201)
      committed = await response.json()
      assert.equal(committed.replayed, false)
      await route.abort('failed')
    }
    try {
      expectFailure('abort')
      await page.route(path, abort)
      await submit.click()
      await dialog.getByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'), { exact: true }).waitFor()
      await page.unroute(path, abort)
      expectFailure('')
      assert.equal(requests.length, 1)
      assert.equal(committed.creation_key, requests[0].key)
      assert.match(requests[0].key, /^[a-f0-9-]{36}$/)
      assert.equal(await dialog.getByLabel(t('Reminder'), { exact: true }).inputValue(), title)
      const afterCommit = await snapshot()
      assert.equal(afterCommit.reminders.length, before.reminders.length + 1)
      assert.equal(afterCommit.audit_events.length, before.audit_events.length + 1)
      for (const table of tables) {
        const ids = new Set(before[table].map((row) => row.id))
        assert.deepEqual(afterCommit[table].filter((row) => ids.has(row.id)), before[table], `Reminder creation changed prior ${table}`)
      }
      const capture = async (name) => {
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(({ id }) => id))
        assert.deepEqual(violations, [])
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        scans++
        await page.screenshot({ path: join(screenshots, `simbi-reminder-retry-${locale}-${name}.png`), fullPage: false })
      }
      await capture('uncertain')
      await dialog.getByLabel(t('Reminder'), { exact: true }).fill(`${title} changed`)
      expectFailure('conflict')
      const conflict = page.waitForResponse((response) => response.url() === path && response.request().method() === 'POST')
      await submit.click()
      assert.equal((await conflict).status(), 409)
      await dialog.getByText(t('This reminder retry reference belongs to different submitted values. Retry the original values or check the saved reminders; no new reminder was created.'), { exact: true }).waitFor()
      expectFailure('')
      assert.equal(requests.length, 2)
      const afterConflict = await snapshot()
      for (const table of tables) assert.deepEqual(afterConflict[table], afterCommit[table])
      await dialog.getByLabel(t('Reminder'), { exact: true }).fill(title)
      const replay = page.waitForResponse((response) => response.url() === path && response.request().method() === 'POST')
      await submit.click()
      const recovered = await replay
      assert.equal(recovered.status(), 201)
      assert.deepEqual(await recovered.json(), { ...committed, replayed: true })
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(requests.length, 3)
      assert.ok(requests.every((request) => request.key === requests[0].key))
      assert.equal(requests[2].body, requests[0].body)
      const afterReplay = await snapshot()
      for (const table of tables) assert.deepEqual(afterReplay[table], afterCommit[table], `Replay changed ${table}`)
      await page.getByText(title, { exact: true }).waitFor()
      await capture('recovered')
      process.stdout.write(`Reminder recovery ${locale}: real committed-response abort, changed-payload refusal, explicit same-key replay, one inserted reminder/audit, preserved prior records.\n`)
    } finally {
      expectFailure('')
      await page.unroute(path, abort)
      page.off('request', observe)
    }
  }
  assert.equal(scans, 4)
}
