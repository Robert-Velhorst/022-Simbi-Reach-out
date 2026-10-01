import assert from 'node:assert/strict'
import test from 'node:test'
import { selectBrowser } from './e2e-browser.mjs'

const engines = { chromium: {}, firefox: {}, webkit: {} }
for (const name of Object.keys(engines)) {
  test(`selects the exact ${name} engine`, () => {
    assert.deepEqual(selectBrowser(engines, name), { name, type: engines[name] })
  })
}
test('rejects unknown, empty, or untrimmed engine names instead of falling back', () => {
  for (const name of ['', 'chrome', 'msedge', 'Firefox', ' firefox', '../chromium']) {
    assert.throws(() => selectBrowser(engines, name), /SIMBI_E2E_BROWSER/)
  }
})
