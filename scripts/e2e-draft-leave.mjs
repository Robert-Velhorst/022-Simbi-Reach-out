import assert from 'node:assert/strict'
import { join } from 'node:path'

// Run inside the existing isolated same-owner draft scenario. No new stored
// records, auth changes, automatic saves, provider requests or synthetic sends.
export async function draftLeaveWorkflow(page, origin, t, locale, name, text, snapshot, axe, screenshots) {
  const before = await snapshot()
  const writes = []
  const record = (request) => {
    if (request.url().startsWith(`${origin}/api/`) && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }
  page.on('request', record)
  const editor = page.locator('.draft-editor')
  const body = page.locator('[name=body]')
  const row = () => page.locator('.review-item').filter({ hasText: name })
  const dialog = () => page.getByRole('dialog', { name: t('Leave this draft?') })
  const keep = async () => {
    const warning = dialog(); await warning.waitFor()
    await warning.getByRole('button', { name: t('Keep editing'), exact: true }).focus()
    await page.keyboard.press('Enter'); await warning.waitFor({ state: 'hidden' })
    assert.equal(await body.inputValue(), text)
    assert.ok(await editor.evaluate((element) => element === document.activeElement), 'Cancel must return focus to the retained editor')
  }
  const discard = async () => {
    const warning = dialog(); await warning.waitFor()
    await warning.getByRole('button', { name: t('Discard local edits and continue'), exact: true }).focus()
    await page.keyboard.press('Enter'); await warning.waitFor({ state: 'hidden' })
  }
  let scans = 0
  let nativeReloadWarnings = 0
  try {
    await body.fill(text)
    await row().click()
    assert.equal(await body.inputValue(), text, 'Selecting the current row must not reset text')
    assert.equal(await dialog().count(), 0)
    const other = page.locator('.review-item').filter({ hasNotText: name }).first()
    assert.ok(await other.count(), 'The retained full workflow supplies another fictional row')
    await other.click(); await keep()
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      if (viewport.width === 390) {
        await page.getByRole('button', { name: t('Open navigation') }).focus(); await page.keyboard.press('Enter')
        const drawer = page.getByRole('dialog', { name: t('Primary navigation') })
        await drawer.getByRole('link', { name: t('Help'), exact: true }).focus(); await page.keyboard.press('Enter')
        await drawer.waitFor({ state: 'hidden' })
      } else {
        await page.getByRole('link', { name: t('Help'), exact: true }).focus(); await page.keyboard.press('Enter')
      }
      const warning = dialog(); await warning.waitFor()
      assert.equal(new URL(page.url()).pathname, '/review')
      assert.ok((await page.title()).includes('Simbi'))
      assert.equal(await page.locator('vite-error-overlay').count(), 0)
      await page.addScriptTag({ content: axe.source })
      const scan = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
      assert.deepEqual(scan.violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) })), [])
      scans++
      const bounds = await warning.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, scroll: element.scrollWidth, client: element.clientWidth } })
      assert.ok(bounds.left >= -0.001 && bounds.right <= bounds.width + 0.001 && bounds.top >= -0.001 && bounds.bottom <= bounds.height + 0.001, JSON.stringify(bounds))
      assert.ok(bounds.scroll <= bounds.client + 1, 'Leave warning must not overflow horizontally')
      await page.screenshot({ path: join(screenshots, `simbi-draft-leave-${locale}-${viewport.width === 390 ? 'mobile' : 'desktop'}.png`), fullPage: false })
      const close = warning.getByRole('button', { name: t('Close'), exact: true })
      const last = warning.getByRole('button', { name: t('Discard local edits and continue'), exact: true })
      await close.focus(); await page.keyboard.press('Shift+Tab')
      assert.ok(await last.evaluate((element) => element === document.activeElement))
      await page.keyboard.press('Tab')
      assert.ok(await close.evaluate((element) => element === document.activeElement))
      await page.keyboard.press('Escape'); await warning.waitFor({ state: 'hidden' })
      assert.equal(await body.inputValue(), text)
      process.stdout.write(`Draft leave Escape focus: ${locale}/${viewport.width}, ${await page.evaluate(() => JSON.stringify({ active: document.activeElement?.tagName, className: document.activeElement?.className, focused: document.hasFocus(), dialogs: document.querySelectorAll('dialog[open]').length, overflow: document.body.style.overflow }))}\n`)
      await page.waitForFunction(() => document.activeElement?.classList.contains('draft-editor'), null, { timeout: 3000 })
      assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'Closing all dialogs must restore body scrolling')
      assert.ok(await editor.evaluate((element) => element === document.activeElement))
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: t('Sign out'), exact: true }).click(); await keep()
    await page.getByRole('button', { name: t('Prepare draft'), exact: true }).click(); await keep()
    // Push a clean Help route, return, then exercise actual same-document Back.
    await page.getByRole('link', { name: t('Help'), exact: true }).click(); await discard()
    await page.waitForURL(`${origin}/help`)
    await page.getByRole('link', { name: t('Review queue'), exact: true }).click()
    await row().click(); await body.fill(text)
    const backwards = page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null)
    await keep(); await backwards
    assert.equal(new URL(page.url()).pathname, '/review')
    const hook = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })
    assert.equal(hook, true)
    // Playwright documents native beforeunload dialog driving for Chromium.
    // Other engines prove the live listener and internal navigation, not a
    // native UI or mobile/forced-close guarantee.
    if (page.context().browser().browserType().name() === 'chromium') {
      const dismiss = async (prompt) => { assert.equal(prompt.type(), 'beforeunload'); nativeReloadWarnings++; await prompt.dismiss() }
      page.on('dialog', dismiss)
      try { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null) }
      finally { page.off('dialog', dismiss) }
      assert.equal(nativeReloadWarnings, 1)
      assert.equal(await body.inputValue(), text)
    }
    assert.deepEqual(await snapshot(), before, 'Leave choices/cancellation must not change any of the nine stored table arrays')
    assert.deepEqual(writes, [], 'No automatic save, auth change, approval, handoff or provider action')
    const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)])
    assert.ok(stored.every((value) => !value.includes(text)))
    process.stdout.write(`Draft leave: ${locale}, same-row retention, other-row/preparation/sign-out cancellation, desktop/mobile Help/Escape/focus/trap, real Back, explicit route discard, nine arrays unchanged, zero writes, ${scans} selected scans, native Chromium reload warnings=${nativeReloadWarnings}; no crash-recovery claim.\n`)
  } finally { page.off('request', record) }
  return scans
}
