import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const catalogs = Object.fromEntries(['en', 'nl'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../frontend/src/locales/${locale}.json`, import.meta.url), 'utf8'))]))
const routes = [
  ['Overview', '/', 'Good morning,'], ['Prospects', '/prospects', 'Prospects'],
  ['Campaigns', '/campaigns', 'Campaigns'], ['Templates', '/templates', 'Templates'],
  ['Review queue', '/review', 'Review queue'], ['Replies', '/replies', 'Replies'],
  ['Reminders', '/reminders', 'Reminders'], ['Reports', '/reports', 'Reports'],
  ['Audit log', '/audit', 'Audit log'], ['Settings', '/settings', 'Settings & safety'],
  ['Help', '/help', 'Operator guide'],
]

// Keyboard actions use actual focus/Tab/Enter/Escape, not DOM-dispatched clicks.
// No provider tab, clipboard, auth change or stored-record write is permitted.
export async function navigationWorkflow(page, origin, axe, screenshots, role = 'owner') {
  const writes = []
  const record = (request) => {
    if (request.url().startsWith(`${origin}/api/`) && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }
  page.on('request', record)
  const snapshot = async () => {
    const response = await page.request.get(`${origin}/api/export`)
    assert.ok(response.ok(), 'Owner snapshot must be readable')
    const payload = await response.json()
    return Object.fromEntries(['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions', 'audit_events'].map((table) => {
      assert.ok(Array.isArray(payload[table]), `Missing owner snapshot: ${table}`)
      return [table, payload[table]]
    }))
  }
  const beforeRecords = role === 'owner' ? await snapshot() : null
  let scans = 0
  try {
    for (const locale of ['en', 'nl']) {
      const t = (key) => {
        assert.ok(Object.hasOwn(catalogs[locale], key), `Missing navigation locale key: ${key}`)
        return catalogs[locale][key]
      }
      const main = page.getByRole('main', { name: t('Main content') })
      const picker = page.getByRole('combobox', { name: 'Language / Taal' })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await picker.selectOption(locale)
      await page.reload({ waitUntil: 'networkidle' })
      assert.ok((await page.title()).includes('Simbi'))
      assert.equal(new URL(page.url()).origin, origin)
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: t('Skip to main content') })
      await assertFocused(skip, 'first-tab bypass')
      assert.ok(await skip.isVisible())
      await page.screenshot({ path: join(screenshots, `simbi-navigation-${role}-${locale}-skip.png`), fullPage: false })
      await page.keyboard.press('Enter')
      await assertFocused(main, 'bypass destination')
      assert.equal(new URL(page.url()).hash, '', 'Bypass must not rewrite the route')

      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        const mobile = viewport.width === 390
        await page.setViewportSize(viewport)
        for (const [label, path, heading] of routes) {
          if (mobile) {
            assert.equal(await page.locator('.sidebar').isVisible(), false, 'Closed desktop sidebar must not be exposed on mobile')
            // The hidden links must not reappear in the accessible navigation tree.
            assert.equal(await page.getByRole('navigation', { name: t('Primary navigation'), exact: true }).count(), 0)
            const trigger = page.getByRole('button', { name: t('Open navigation') })
            await trigger.focus()
            await page.keyboard.press('Enter')
            const dialog = page.getByRole('dialog', { name: t('Primary navigation') })
            await dialog.waitFor()
            const drawerBounds = await dialog.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
            })
            assert.ok(drawerBounds.left >= 0 && drawerBounds.top >= 0 && drawerBounds.right <= drawerBounds.width && drawerBounds.bottom <= drawerBounds.height, 'Navigation drawer must stay inside the viewport')
            await assertFocused(dialog.getByRole('button', { name: t('Close'), exact: true }), 'drawer initial focus')
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
            assert.equal(await trigger.getAttribute('aria-controls'), await dialog.getAttribute('id'))
            // Close is first; Sign out is last. Both directions stay inside.
            await page.keyboard.press('Shift+Tab')
            await assertFocused(dialog.getByRole('button', { name: t('Sign out'), exact: true }), 'backward trap')
            await page.keyboard.press('Tab')
            await assertFocused(dialog.getByRole('button', { name: t('Close'), exact: true }), 'forward trap')
            if (label === 'Overview') {
              await scan(page, axe, `${role}/${locale}/open drawer`); scans++
              await page.screenshot({ path: join(screenshots, `simbi-navigation-${role}-${locale}-mobile.png`), fullPage: false })
              await page.keyboard.press('Escape')
              await dialog.waitFor({ state: 'hidden' })
              await assertFocused(trigger, 'Escape return focus')
              await page.keyboard.press('Space')
              await dialog.waitFor()
              await page.mouse.click(375, 20)
              await dialog.waitFor({ state: 'hidden' })
              await assertFocused(trigger, 'backdrop return focus')
              await page.keyboard.press('Space')
              await dialog.waitFor()
            }
            // Traverse from Close through actual sequential tab order to the route.
            const target = dialog.getByRole('link', { name: t(label), exact: true })
            await tabTo(page, target, 12)
            await page.keyboard.press('Enter')
            await dialog.waitFor({ state: 'hidden' })
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
          } else {
            const target = page.getByRole('link', { name: t(label), exact: true })
            await target.focus()
            await page.keyboard.press('Enter')
          }
          await page.waitForURL(`${origin}${path}`)
          await page.getByRole('heading', { name: t(heading), exact: heading !== 'Good morning,' }).first().waitFor()
          await assertFocused(main, `${label} destination`)
          await page.waitForLoadState('networkidle')
          assert.equal(await page.locator('vite-error-overlay').count(), 0)
          if (mobile) {
            for (const table of await page.locator('.table-wrap').all()) {
              assert.equal(await table.getAttribute('tabindex'), '0')
              assert.ok(await table.getAttribute('aria-label'))
              const overflow = await table.evaluate((element) => element.scrollWidth > element.clientWidth)
              if (overflow) {
                await table.focus()
                const before = await table.evaluate((element) => element.scrollLeft)
                await page.keyboard.press('ArrowRight')
                await page.waitForFunction(({ element, before }) => element.scrollLeft > before, { element: await table.elementHandle(), before })
                await table.evaluate((element) => { element.scrollLeft = 0 })
              }
            }
          }
          await scan(page, axe, `${role}/${locale}/${mobile ? 'mobile' : 'desktop'}${path}`); scans++
        }
      }
      // Small screens must expose the final controls through contained scrolling.
      await page.setViewportSize({ width: 390, height: 450 })
      const trigger = page.getByRole('button', { name: t('Open navigation') })
      await trigger.focus(); await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: t('Primary navigation') })
      await dialog.waitFor()
      await page.keyboard.press('Shift+Tab')
      const signOut = dialog.getByRole('button', { name: t('Sign out'), exact: true })
      await assertFocused(signOut, 'short drawer final control')
      const bounds = await signOut.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, height: innerHeight }
      })
      assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, 'Focused final control must scroll into the short viewport')
      await scan(page, axe, `${role}/${locale}/short drawer`); scans++
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      await assertFocused(trigger, 'short drawer Escape')
      // Resize must not leave the desktop app blocked by an invisible mobile modal.
      await page.keyboard.press('Enter'); await dialog.waitFor()
      await page.setViewportSize({ width: 1440, height: 1000 })
      await dialog.waitFor({ state: 'hidden' }); await assertFocused(main, 'desktop resize destination')
    }
    assert.deepEqual(writes, [], 'Navigation and language selection must not mutate account/workspace records')
    if (beforeRecords) assert.deepEqual(await snapshot(), beforeRecords, 'All nine exported owner record tables must be unchanged by navigation')
    assert.equal(scans, 48, 'Eleven routes × two viewports × two locales plus four open-drawer scans')
    process.stdout.write(`Keyboard navigation: ${role}, 44 route checks + 4 drawer scans in English/Dutch; Escape, focus, resize, short-screen scroll, zero writes passed.\n`)
  } finally {
    page.off('request', record)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
  }
}

async function assertFocused(locator, label) {
  await locator.page().waitForFunction((element) => element === document.activeElement, await locator.elementHandle())
  assert.ok(await locator.evaluate((element) => element === document.activeElement), `Incorrect focus: ${label}`)
}
async function tabTo(page, target, limit) {
  for (let index = 0; index < limit; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Navigation route was unreachable by sequential Tab')
}
async function scan(page, axe, label) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axe.source })
  const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
  assert.deepEqual(result.violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) })), [], `Automated accessibility violations: ${label}`)
}
