import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, enter, choose, tabTo } from './e2e-keyboard-controls.mjs'

const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))

// All app navigation, entry and actions below use sequential Tab and keyboard
// input. Locators/evaluation only observe the UI; request calls only read it.
export async function keyboardOutreachWorkflow(page, origin, axe, screenshots) {
  // Establish the already-authenticated entry boundary independently of the
  // preceding sibling-tab test's browser-chrome focus. No records are written;
  // every application interaction after this one preflight reload is keyboard.
  await page.reload({ waitUntil: 'networkidle' })
  const errors = []
  const writes = []
  const onError = (error) => errors.push(error.message)
  const onConsole = (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) }
  const onRequest = (request) => {
    const url = new URL(request.url())
    assert.equal(url.origin, origin, 'Keyboard acceptance must never reach a provider')
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`)
  }
  page.on('pageerror', onError); page.on('console', onConsole); page.on('request', onRequest)
  let scans = 0
  const routes = []
  try {
    await page.evaluate(() => {
      window.keyboardProof = { pointer: 0, keys: 0 }
      const pointer = () => window.keyboardProof.pointer++
      const keys = () => window.keyboardProof.keys++
      document.addEventListener('pointerdown', pointer)
      document.addEventListener('keydown', keys)
      window.keyboardProofCleanup = () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', keys); delete window.keyboardProof; delete window.keyboardProofCleanup }
    })
    for (const locale of ['en', 'nl']) {
      const mobile = locale === 'nl'
      const t = (key) => { assert.ok(Object.hasOwn(catalogs[locale], key), `Missing keyboard key: ${key}`); return catalogs[locale][key] }
      const button = (key, scope = page) => scope.getByRole('button', { name: t(key), exact: true })
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
      await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
      assert.equal(await page.locator('html').getAttribute('lang'), locale)
      const nav = async (key, path) => {
        if (mobile) {
          await activate(page, button('Open navigation'))
          await page.getByRole('dialog', { name: t('Primary navigation') }).waitFor()
        }
        await activate(page, page.getByRole('link', { name: t(key), exact: true }))
        await page.waitForURL(`${origin}${path}`)
        await page.waitForLoadState('networkidle')
        assert.ok(await page.getByRole('main', { name: t('Main content') }).evaluate((element) => element === document.activeElement), 'Route change must focus its destination')
      }
      const capture = async (name) => {
        assert.ok((await page.title()).includes('Simbi'))
        assert.equal(new URL(page.url()).origin, origin)
        assert.equal(await page.locator('vite-error-overlay').count(), 0)
        assert.ok(await page.getByRole('main', { name: t('Main content') }).textContent())
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })))
        assert.deepEqual(violations, [], `${locale}/${name} selected accessibility rules`)
        const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
        assert.ok(geometry.scroll <= geometry.width, 'Keyboard workflow must not overflow the viewport')
        scans++
        await page.screenshot({ path: join(screenshots, `simbi-keyboard-${locale}-${name}.png`), fullPage: false })
      }
      const snapshot = async () => {
        const response = await page.request.get(`${origin}/api/export`)
        assert.ok(response.ok())
        return response.json()
      }
      const uncertainCreation = async (path, submit, fields, corrupt, destination, name) => {
        const beforeRecord = await snapshot()
        const beforeWrites = writes.length
        let committed
        const pattern = `${origin}/api/${path}`
        const handler = async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          const response = await route.fetch()
          assert.equal(response.status(), 201, 'Damage a real successful commit, not a fake creation')
          committed = await response.json()
          await route.fulfill({ response, json: { ...committed, ...corrupt(committed) } })
        }
        routes.push([pattern, handler])
        await page.route(pattern, handler)
        await activate(page, button(submit, dialog))
        await dialog.getByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'), { exact: true }).waitFor()
        assert.ok(await dialog.isVisible(), 'Readable but mismatched confirmation must retain the form')
        for (const [field, value] of Object.entries(fields)) assert.equal(await dialog.locator(`[name=${field}]`).inputValue(), value)
        assert.equal(writes.length, beforeWrites + 1, 'An unverified confirmation must not repeat creation')
        const readback = await snapshot()
        assert.equal(readback[path].length, beforeRecord[path].length + 1)
        assert.equal(readback[path].filter((item) => item.id === committed.id).length, 1)
        await capture(`${path}-confirmation-unverified`)
        await page.unroute(pattern, handler)
        routes.splice(routes.findIndex(([saved]) => saved === pattern), 1)
        await activate(page, button('Cancel', dialog))
        await dialog.waitFor({ state: 'hidden' })
        // Deliberate read-only route revisit, not an automatic write retry/reload.
        await nav('Overview', '/')
        await nav(destination[0], destination[1])
        process.stdout.write(`Confirmation recovery: ${locale}/${name}, actual committed record retained, mismatched response rejected, one UI write, native Cancel and explicit read-only revisit.\n`)
      }
      const before = await snapshot()
      const startWrites = writes.length
      const campaignName = `000 Keyboard fictional campaign ${locale}`
      const personName = `000 Keyboard fictional person ${locale}`
      const templateName = `000 Keyboard fictional template ${locale}`
      const authored = `Fictional keyboard-only message for ${personName}. No provider account, real contact or delivery is involved.`

      await nav('Campaigns', '/campaigns')
      const trigger = button('New campaign')
      await activate(page, trigger)
      let dialog = page.getByRole('dialog', { name: t('Create campaign') })
      await dialog.waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(await trigger.evaluate((element) => element === document.activeElement), 'Escape must restore campaign trigger')
      await activate(page, trigger)
      await dialog.waitFor()
      // A genuinely empty native form cannot mutate the server.
      await activate(page, button('Create draft campaign', dialog))
      assert.ok(await dialog.isVisible())
      assert.ok(await dialog.locator('[name=name]').evaluate((element) => element === document.activeElement && !element.validity.valid))
      assert.equal(writes.length, startWrites)
      await enter(page, dialog.locator('[name=name]'), campaignName)
      await enter(page, dialog.locator('[name=purpose]'), 'Fictional personal keyboard acceptance; never contact anyone.')
      await enter(page, dialog.locator('[name=lawful_basis]'), 'Isolated fictional local QA, not a permission to use Simbi.')
      await activate(page, button('Create draft campaign', dialog))
      await dialog.waitFor({ state: 'hidden' })
      const campaignRow = page.locator('.resource-row').filter({ hasText: campaignName })
      await activate(page, button('Activate', campaignRow))
      await button('Pause', campaignRow).waitFor()
      // The label can change during readback while the row is still disabled.
      // Verify native reachability only after the actual pending action settles.
      await tabTo(page, button('Pause', campaignRow))

      await nav('Prospects', '/prospects')
      await activate(page, button('Add prospect'))
      dialog = page.getByRole('dialog', { name: t('Add prospect') })
      await dialog.waitFor()
      await enter(page, dialog.locator('[name=name]'), personName)
      await enter(page, dialog.locator('[name=source_url]'), `https://simbi.com/never-send-keyboard-${locale}`)
      await choose(page, dialog.locator('[name=consent_status]'), 'consented')
      await activate(page, button('Add prospect', dialog))
      await dialog.waitFor({ state: 'hidden' })
      await page.getByText(personName, { exact: true }).waitFor()

      await nav('Templates', '/templates')
      await activate(page, button('New template'))
      dialog = page.getByRole('dialog', { name: t('Create template') })
      await dialog.waitFor()
      await enter(page, dialog.locator('[name=name]'), templateName)
      await enter(page, dialog.locator('[name=subject]'), `NEVER SEND — keyboard ${locale}`)
      await enter(page, dialog.locator('[name=body]'), 'Hello {name}. This is only a fictional local keyboard test. No thanks is completely fine; no message will be sent.')
      await activate(page, button('Create template', dialog))
      await dialog.waitFor({ state: 'hidden' })

      await nav('Review queue', '/review')
      await activate(page, button('Prepare draft'))
      dialog = page.getByRole('dialog', { name: t('Prepare a deterministic draft') })
      await dialog.waitFor()
      // Observe IDs from the actual UI-created records; no fixture writes.
      let records = await snapshot()
      const campaign = records.campaigns.find((item) => item.name === campaignName)
      const person = records.prospects.find((item) => item.name === personName)
      const template = records.templates.find((item) => item.name === templateName)
      assert.ok(campaign && person && template)
      await choose(page, dialog.locator('[name=campaign_id]'), String(campaign.id))
      await choose(page, dialog.locator('[name=prospect_id]'), String(person.id))
      await choose(page, dialog.locator('[name=template_id]'), String(template.id))
      await uncertainCreation('drafts', 'Prepare draft', { campaign_id: String(campaign.id), prospect_id: String(person.id), template_id: String(template.id) }, (created) => ({ campaign_id: created.campaign_id + 10000 }), ['Review queue', '/review'], 'draft selections')
      await activate(page, page.locator('.review-item').filter({ hasText: personName }))
      const draft = (await snapshot()).drafts.find((item) => item.prospect_id === person.id)
      assert.ok(draft)
      await enter(page, page.locator('[name=body]'), authored)
      assert.ok(await button('Approve for handoff').isDisabled(), 'Unsaved message cannot be approved')
      const savedResponse = page.waitForResponse((response) => response.url() === `${origin}/api/drafts/${draft.id}` && response.request().method() === 'PATCH')
      await activate(page, button('Save and return to review'))
      assert.equal((await savedResponse).status(), 200)
      await page.waitForFunction(() => document.querySelector('.draft-editor button')?.disabled === true && document.querySelector('.draft-editor [name=body]')?.disabled === false)
      assert.equal(await page.locator('[name=body]').inputValue(), authored)
      for (const checkbox of await page.locator('.approval-box input[type=checkbox]').all()) await activate(page, checkbox, 'Space')
      await capture(mobile ? 'review-mobile' : 'review-desktop')
      await activate(page, button('Approve for handoff'))
      await activate(page, button('Copy and open provider'))
      dialog = page.getByRole('dialog', { name: t('Manual provider handoff') })
      await dialog.waitFor()
      assert.ok((await dialog.getByLabel(t('Approved message')).inputValue()).includes(authored))
      await capture(mobile ? 'handoff-mobile' : 'handoff-desktop')
      // This is only local fictional uncertainty, never provider delivery.
      await activate(page, button('Unsure — needs verification', dialog))
      await dialog.waitFor({ state: 'hidden' })
      await activate(page, button('Resolve latest handoff'))
      await dialog.waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(await button('Resolve latest handoff').evaluate((element) => element === document.activeElement))

      await nav('Reminders', '/reminders')
      const reminderName = `Keyboard follow-up review ${locale}`
      await activate(page, button('New reminder'))
      dialog = page.getByRole('dialog', { name: t('Create reminder') })
      await dialog.waitFor()
      await choose(page, dialog.locator('[name=draft_id]'), String(draft.id))
      await enter(page, dialog.locator('[name=title]'), reminderName)
      await tabTo(page, dialog.locator('[name=due_at]'))
      // Increment native date/time segments without assigning a DOM value.
      // Their order/defaults differ by browser/OS; the user's displayed value
      // is read back and checked against the resulting server record below.
      for (let segment = 0; segment < 6; segment++) { await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowRight') }
      // Some native controls have no usable keyboard editor. Select the app's
      // explicit text-entry option with Space, then type its documented format.
      // This is the same fallback available to the operator, not a DOM bypass.
      if (!(await dialog.locator('[name=due_at]').inputValue())) {
        await activate(page, dialog.getByRole('checkbox', { name: t('Enter date and time as text'), exact: true }), 'Space')
        await enter(page, dialog.locator('[name=due_at]'), '2027-11-02T07:58')
      }
      const due = await dialog.locator('[name=due_at]').inputValue()
      assert.match(due, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Native keyboard date must be complete')
      assert.ok(await dialog.locator('[name=due_at]').evaluate((element) => element.validity.valid))
      // New writes use UTC with six fractional digits; retain exact stored-value proof.
      const expectedDue = (await dialog.locator('[name=due_at]').evaluate((element) => new Date(element.value).toISOString())).replace('Z', '000+00:00')
      await capture(mobile ? 'reminder-mobile' : 'reminder-desktop')
      await uncertainCreation('reminders', 'Create reminder', { draft_id: String(draft.id), title: reminderName, due_at: due }, () => ({ due_at: '2000-01-01T00:00:00.000000+00:00' }), ['Reminders', '/reminders'], 'reminder instant')
      await page.getByText(reminderName, { exact: true }).waitFor()
      const reminder = (await snapshot()).reminders.find((item) => item.title === reminderName)
      assert.ok(reminder && reminder.due_at === expectedDue && reminder.status === 'open')

      await nav('Replies', '/replies')
      await activate(page, button('Record reply'))
      dialog = page.getByRole('dialog', { name: t('Record provider reply') })
      await dialog.waitFor()
      await choose(page, dialog.locator('[name=draft_id]'), String(draft.id))
      const reply = `Fictional keyboard reply ${locale}; no provider conversation took place.`
      await enter(page, dialog.locator('[name=body]'), reply)
      await uncertainCreation('replies', 'Record reply', { draft_id: String(draft.id), body: reply }, () => ({ body: 'A different fictional reply, never the entered text.' }), ['Replies', '/replies'], 'reply content')
      await page.getByText(reply, { exact: true }).waitFor()
      records = await snapshot()
      assert.equal(records.drafts.find((item) => item.id === draft.id).state, 'replied')
      assert.equal(records.reminders.find((item) => item.id === reminder.id).status, 'cancelled', 'Reply must cancel the open review reminder, not mark it completed')
      assert.equal(records.replies.filter((item) => item.draft_id === draft.id).length, 1)
      assert.equal(records.handoffs.filter((item) => item.draft_id === draft.id).length, 1)

      await nav('Reports', '/reports')
      const reportRow = page.getByRole('row').filter({ hasText: campaignName })
      await reportRow.waitFor()
      assert.deepEqual(await reportRow.getByRole('cell').allTextContents(), [campaignName, t('active'), '1', '0', '1', String(records.drafts.find((item) => item.id === draft.id).quality_score)])
      await nav('Prospects', '/prospects')
      const prospectRow = page.getByRole('row').filter({ hasText: personName })
      await activate(page, button('Stop contact', prospectRow))
      dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await enter(page, dialog.locator('[name=reason]'), `Fictional keyboard restriction ${locale}; no real contact`)
      await activate(page, button('Confirm stop contact', dialog))
      await dialog.waitFor({ state: 'hidden' })
      await page.waitForFunction((name) => [...document.querySelectorAll('tbody tr')].some((row) => row.textContent.includes(name) && row.querySelector('button')?.disabled), personName)
      assert.ok(await page.getByRole('region', { name: t('Prospects'), exact: true }).evaluate((element) => element === document.activeElement), 'Confirmed stop must restore the named region, not its disabled trigger')
      const after = await snapshot()
      assert.equal(after.prospects.find((item) => item.id === person.id).consent_status, 'opted_out')
      assert.equal(after.suppressions.filter((item) => item.prospect_id === person.id).length, 1)
      assert.equal(after.drafts.find((item) => item.id === draft.id).state, 'replied', 'Historical reply must survive stopping contact')
      for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) {
        assert.ok(Array.isArray(before[table]) && Array.isArray(after[table]))
        assert.deepEqual(after[table].filter((item) => before[table].some((old) => old.id === item.id)), before[table], `Keyboard fixture must preserve prior ${table}`)
      }
      assert.deepEqual(after.audit_events.filter((item) => before.audit_events.some((old) => old.id === item.id)), before.audit_events, 'Intentional writes may append audit events, never alter existing audit history')
      assert.deepEqual(writes.slice(startWrites), [
        'POST /api/campaigns', `PATCH /api/campaigns/${campaign.id}/status`, 'POST /api/prospects', 'POST /api/templates', 'POST /api/drafts', `PATCH /api/drafts/${draft.id}`,
        `POST /api/drafts/${draft.id}/review`, `POST /api/drafts/${draft.id}/handoff`, `POST /api/handoffs/${after.handoffs.find((item) => item.draft_id === draft.id).id}/outcome`,
        'POST /api/reminders', 'POST /api/replies', 'POST /api/suppressions',
      ], 'Only the twelve deliberate fictional local mutations may occur')
      process.stdout.write(`Keyboard outreach: ${locale}/${mobile ? '390x844' : '1440x1000'}, sequential Tab/Shift+Tab only, native form validation/Escape, campaign/prospect/template/draft/save/review/uncertainty/reminder/reply/report/stop; three actual committed-but-mismatched creation recoveries, 12 UI writes, prior records preserved, zero provider or pointer actions.\n`)
    }
    const proof = await page.evaluate(() => window.keyboardProof)
    assert.equal(proof.pointer, 0)
    assert.ok(proof.keys > 100)
    assert.deepEqual(errors, [])
    assert.equal(scans, 12)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), 'en')
  } finally {
    for (const [pattern, handler] of routes) await page.unroute(pattern, handler)
    page.off('pageerror', onError); page.off('console', onConsole); page.off('request', onRequest)
    await page.evaluate(() => window.keyboardProofCleanup?.())
  }
}
