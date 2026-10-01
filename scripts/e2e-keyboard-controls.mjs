import assert from 'node:assert/strict'

// Locators observe destinations; only actual sequential keys change focus/input.
export async function tabTo(page, target) {
  await target.waitFor({ state: 'visible' })
  assert.equal(await target.count(), 1, 'Keyboard destination must be unambiguous')
  const deadline = Date.now() + 30_000
  while (!(await target.isEnabled())) {
    assert.ok(Date.now() < deadline, `Keyboard destination stayed disabled: ${await target.evaluate((element) => element.outerHTML)}`)
    await page.waitForTimeout(50)
  }
  // Backward traversal reaches earlier controls without relying on browser-chrome
  // forward wrap; BODY keeps native forward continuation after disabled controls.
  const key = await target.evaluate((element) => element.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING ? 'Shift+Tab' : 'Tab')
  for (let step = 0; step < 180; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press(key)
  }
  assert.fail(`Not reachable through sequential Tab: ${await target.evaluate((element) => element.outerHTML)}`)
}

export async function activate(page, target, key = 'Enter') {
  await tabTo(page, target)
  assert.ok(await target.isEnabled(), 'Keyboard action must remain enabled')
  await page.keyboard.press(key)
}

export async function enter(page, target, value) {
  await tabTo(page, target)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(value)
  assert.equal(await target.inputValue(), value)
}

export async function choose(page, target, value) {
  await tabTo(page, target)
  const options = await target.locator('option').count()
  await page.keyboard.press('Home')
  for (let step = 0; step <= options; step++) {
    if (await target.inputValue() === value) return
    await page.keyboard.press('ArrowDown')
  }
  assert.fail(`Native keyboard selection could not reach option ${value}`)
}
