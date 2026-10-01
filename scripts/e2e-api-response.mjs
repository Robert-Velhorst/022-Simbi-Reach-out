import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectBrowser } from './e2e-browser.mjs'
import { activate, choose, enter, tabTo } from './e2e-keyboard-controls.mjs'

// An owned loopback proxy, not a production endpoint. It forwards the real
// fictional write first, then damages its RESPONSE. Native streaming bodies
// prove the full deadline; route.fulfill delay alone would only test headers.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const engine = selectBrowser(require('playwright'))
const axe = require('axe-core')
const screenshots = resolve(root, '..', 'browser-qa', engine.name)
const runtimeRoot = resolve(root, '.e2e-runtime')
await mkdir(screenshots, { recursive: true }); await mkdir(runtimeRoot, { recursive: true })
const python = process.env.SIMBI_E2E_PYTHON ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const port = process.env.SIMBI_RESPONSE_E2E_PORT ?? '4180'
assert.ok(/^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535, 'Invalid isolated response test port')
const backend = `http://127.0.0.1:${port}`
const unknownKey = 'The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'
const unreadableKey = 'The local service returned an unreadable response. Reload the current records; no result was verified.'

for (const locale of ['en', 'nl']) {
  const runtime = await mkdtemp(join(runtimeRoot, `response-${engine.name}-${locale}-`))
  const catalog = JSON.parse(await readFile(join(root, 'frontend', 'src', 'locales', `${locale}.json`), 'utf8'))
  const t = (key) => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} response key`); return catalog[key] }
  let fault = null
  let releasePending = null
  let templateWrites = 0
  let streamed = 0
  let abortedBodies = 0
  const proxyErrors = []
  const proxy = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url, backend).pathname
    const selected = fault && fault.method === incoming.method && path === '/api/templates' ? fault : null
    if (selected) fault = null
    if (incoming.method === 'POST' && path === '/api/templates') templateWrites++
    const upstream = request(new URL(incoming.url, backend), { method: incoming.method, headers: incoming.headers }, (response) => {
      if (!selected) { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); return }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        proxyErrors.push('Fault did not receive a real successful response')
        outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); return
      }
      // Consume the upstream to establish that the actual commit/read completed.
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.resume()
      response.once('end', () => {
        const headers = { ...response.headers }
        delete headers['content-length']; delete headers['transfer-encoding']
        outgoing.writeHead(response.statusCode, headers)
        if (selected.mode === 'malformed') outgoing.end('<fictional proxy response>')
        else if (selected.mode === 'empty') {
          // Firefox's network observer waits for an initial body chunk even
          // after flushHeaders. JSON whitespace starts the actual body without
          // completing it; the client must still wait for explicit release.
          outgoing.write(' ')
          outgoing.flushHeaders()
          releasePending = () => { outgoing.end('{}'); releasePending = null }
        } else if (selected.mode === 'mismatch') {
          const saved = JSON.parse(Buffer.concat(chunks).toString())
          outgoing.end(JSON.stringify({ ...saved, body: 'A different fictional response body, not the authored template.' }))
        } else if (selected.mode === 'wrong-page') {
          const actual = JSON.parse(Buffer.concat(chunks).toString())
          outgoing.end(JSON.stringify({ ...actual, offset: actual.offset + 50 }))
        }
        else {
          streamed++
          outgoing.write('{"unfinished":')
          outgoing.flushHeaders()
          outgoing.once('close', () => { if (!outgoing.writableFinished) abortedBodies++ })
        }
      })
    })
    upstream.on('error', () => { proxyErrors.push('Owned upstream failed'); outgoing.destroy() })
    incoming.pipe(upstream)
  })
  await new Promise((done, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', done) })
  const origin = `http://127.0.0.1:${proxy.address().port}`
  const logs = []
  const token = randomUUID().replaceAll('-', '')
  const secret = randomUUID()
  const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', port], {
    cwd: root,
    env: { ...process.env, SIMBI_ENV: 'test', SIMBI_DATABASE_PATH: join(runtime, 'response.db'), SIMBI_BACKUP_PATH: join(runtime, 'backups'), SIMBI_FRONTEND_ORIGIN: origin, SIMBI_COOKIE_SECURE: 'false', SIMBI_ALLOWED_HOSTS: '127.0.0.1', SIMBI_AUTO_BACKUP: 'false', SIMBI_REQUIRE_MAINTENANCE: 'false', SIMBI_SETUP_TOKEN: token, SIMBI_HAI_FEED_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  let browser
  try {
    const deadline = Date.now() + 60_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      assert.equal(server.exitCode, null, 'Owned response server exited before binding')
      if (logs.join('').includes(`Uvicorn running on ${backend}`)) {
        try { ready = (await fetch(`${backend}/api/health/ready`)).ok } catch { /* Owned startup only. */ }
      }
      if (!ready) await new Promise((done) => setTimeout(done, 250))
    }
    assert.ok(ready, 'Owned isolated response server did not become ready')
    browser = await engine.type.launch({ headless: true })
    const mobile = locale === 'nl'
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, bypassCSP: true })
    const errors = []
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      errors.push('Unexpected external response-test request'); return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    const templateResponses = []
    page.on('response', (response) => { if (new URL(response.url()).pathname === '/api/templates' && response.request().method() === 'POST') templateResponses.push(response.status()) })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await page.request.post(`${origin}/api/auth/setup`, { data: { setup_token: token, display_name: 'Fictional Response Owner', workspace_name: 'Fictional Response Workspace', email: `response-${locale}@example.test`, password: secret } }).then(async (result) => assert.ok(result.ok(), 'Fixture setup failed'))
    const read = async () => { const result = await page.request.get(`${origin}/api/templates`); assert.ok(result.ok()); return result.json() }
    await page.goto(`${origin}/templates`, { waitUntil: 'networkidle' })
    try { await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale) }
    catch (cause) {
      await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-entry-diagnostic.png`) })
      console.error(JSON.stringify({ locale, origin, url: page.url(), title: await page.title(), errors, entry: await page.evaluate(() => ({ textLength: document.body.textContent.length, headings: [...document.querySelectorAll('h1,h2')].map((item) => item.textContent), overlay: Boolean(document.querySelector('vite-error-overlay')) })) }))
      throw cause
    }
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    let scans = 0
    const capture = async (state) => {
      assert.equal(page.url(), `${origin}/templates`)
      assert.ok((await page.title()).includes('Simbi'))
      assert.ok((await page.locator('main').textContent()).trim())
      assert.equal(await page.locator('vite-error-overlay').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.addScriptTag({ content: axe.source })
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id }) => id))
      assert.deepEqual(violations, [], `${locale}/${state} accessibility`); scans++
      await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-${state}.png`), fullPage: false })
    }
    const createUncertain = async (mode) => {
      await activate(page, button('New template'))
      const dialog = page.getByRole('dialog', { name: t('Create template') })
      await dialog.waitFor()
      const title = `Fictional ${locale} ${mode} template`
      if (mode === 'malformed') {
        const before = templateWrites
        await enter(page, dialog.getByLabel(t('Template name')), 'X')
        await activate(page, dialog.getByRole('button', { name: t('Create template'), exact: true }))
        assert.equal(templateWrites, before, 'Native short-name validation must not dispatch')
        assert.ok(await dialog.getByLabel(t('Template name')).evaluate((element) => !element.validity.valid))
      }
      try { await enter(page, dialog.getByLabel(t('Template name')), title) }
      catch (cause) {
        await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-diagnostic.png`) })
        console.error(JSON.stringify({ locale, mode, dialogCount: await page.locator('dialog').count(), inputCount: await page.locator('input[name=name]').count(), state: await page.evaluate(() => ({ activeTag: document.activeElement?.tagName, dialogs: [...document.querySelectorAll('dialog')].map((item) => ({ open: item.open, modal: item.matches(':modal'), title: item.querySelector('h2')?.textContent })) })), errors }))
        throw cause
      }
      const writesBefore = templateWrites
      fault = { method: 'POST', mode }
      const headers = page.waitForResponse((result) => result.url() === `${origin}/api/templates` && result.request().method() === 'POST' && result.status() === 201)
      const started = Date.now()
      await activate(page, dialog.getByRole('button', { name: t('Create template'), exact: true }))
      try { await headers } // This must resolve BEFORE a stalled body finishes or times out.
      catch (cause) {
        await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-${mode}-submit-diagnostic.png`) })
        console.error(JSON.stringify({ locale, mode, templateWrites, templateResponses, proxyErrors, errors, form: await dialog.locator('form').evaluate((form) => ({ valid: form.checkValidity(), busy: form.getAttribute('aria-busy'), activeTag: document.activeElement?.tagName, fields: [...form.elements].filter((item) => 'validity' in item).map((item) => ({ name: item.name, disabled: item.matches(':disabled'), valid: item.validity.valid, tooShort: item.validity.tooShort, valueLength: typeof item.value === 'string' ? item.value.length : null })) })) }))
        throw cause
      }
      const headerElapsed = Date.now() - started
      if (mode === 'empty') {
        assert.ok(headerElapsed < 10_000, 'Held body headers must precede completion')
        await dialog.getByText(t('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.'), { exact: true }).waitFor()
        assert.ok(await dialog.getByLabel(t('Template name')).isDisabled())
        assert.ok(await dialog.getByRole('button', { name: t('Create template'), exact: true }).isDisabled())
        assert.ok(await dialog.getByRole('button', { name: t('Cancel'), exact: true }).isDisabled())
        assert.ok(await dialog.getByRole('button', { name: t('Close'), exact: true }).isDisabled())
        await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape')
        assert.ok(await dialog.isVisible(), 'Pending Escape must not discard the form')
        assert.equal(templateWrites, writesBefore + 1, 'Pending Enter must not submit again')
        assert.equal((await read()).items.filter((item) => item.name === title).length, 1)
        await tabTo(page, dialog.locator('form'))
        assert.ok(await dialog.locator('form').evaluate((form) => document.activeElement === form), 'Pending form must remain keyboard reachable for scrolling')
        await capture('empty-pending')
        assert.equal(typeof releasePending, 'function', 'Real successful response must be held')
        releasePending()
      }
      await dialog.getByText(t(unknownKey), { exact: true }).waitFor({ timeout: 30_000 })
      if (mode === 'stall') {
        assert.ok(headerElapsed < 10_000, 'Headers were not delivered before the deadline')
        assert.ok(Date.now() - started >= 19_000, 'The real full-body deadline was not exercised')
      }
      assert.equal(await dialog.getByLabel(t('Template name')).inputValue(), title)
      assert.equal(templateWrites, writesBefore + 1, 'No automatic write retry')
      assert.equal((await read()).items.filter((item) => item.name === title).length, 1, 'A real commit can precede unreadable response')
      await capture(mode)
      const cancel = dialog.getByRole('button', { name: t('Cancel'), exact: true })
      await tabTo(page, cancel)
      if (mobile) await page.keyboard.press('End')
      // A long localized warning can push the action row below the first
      // viewport. Native End scrolling must reveal BOTH complete actions;
      // merely focusing a partially visible button is not sufficient proof.
      try { await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll('dialog[open] .modal-actions button')]
        return buttons.length === 2 && buttons.every((item) => { const box = item.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth })
      }, undefined, { timeout: 3000 }) } catch (cause) {
        await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-${mode}-bounds-diagnostic.png`) })
        console.error(JSON.stringify({ locale, mode, actionBounds: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, active: document.activeElement?.tagName, buttons: [...document.querySelectorAll('dialog[open] .modal-actions button')].map((item) => { const box = item.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right } }), scrollers: [...document.querySelectorAll('dialog[open], dialog[open] .modal-content')].map((item) => ({ scroll: item.scrollTop, client: item.clientHeight, height: item.scrollHeight })) })) }))
        throw cause
      }
      if (mobile) await page.screenshot({ path: join(screenshots, `simbi-response-${locale}-${mode}-actions.png`), fullPage: false })
      await activate(page, cancel)
      await dialog.waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: title, exact: true }).waitFor()
      assert.equal(templateWrites, writesBefore + 1)
    }
    await createUncertain('malformed')
    await createUncertain('empty')
    await createUncertain('mismatch')
    for (const mode of ['malformed', 'wrong-page']) {
      fault = { method: 'GET', mode }
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByText(t(unreadableKey), { exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: t('No templates'), exact: true }).count(), 0)
      await activate(page, button('Retry'))
      await page.getByRole('heading', { name: `Fictional ${locale} malformed template`, exact: true }).waitFor()
    }
    if (mobile) await createUncertain('stall')
    else {
      fault = { method: 'GET', mode: 'stall' }
      const headers = page.waitForResponse((result) => result.url().startsWith(`${origin}/api/templates?`) && result.status() === 200)
      const started = Date.now()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await headers
      assert.ok(Date.now() - started < 10_000)
      await page.getByText(t('The request timed out. Check the service and try again.'), { exact: true }).waitFor({ timeout: 30_000 })
      assert.ok(Date.now() - started >= 19_000)
      assert.equal(await page.locator('[aria-busy=true]').count(), 0)
      await activate(page, button('Retry'))
      await page.getByRole('heading', { name: 'Fictional en malformed template', exact: true }).waitFor()
    }
    await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'))
    const closeDeadline = Date.now() + 3000
    while (!abortedBodies && Date.now() < closeDeadline) await new Promise((done) => setTimeout(done, 50))
    assert.equal(streamed, 1); assert.equal(abortedBodies, 1, 'Native deadline must close its streamed body')
    assert.equal(templateWrites, mobile ? 4 : 3)
    assert.equal(scans, mobile ? 5 : 4)
    assert.deepEqual(errors, []); assert.deepEqual(proxyErrors, [])
    console.log(JSON.stringify({ browserEngine: engine.name, browserVersion: browser.version(), locale, origin, viewport: mobile ? '390x844' : '1440x1000', completeResponseBoundary: 'passed', committedButUnverifiedWrite: 'passed', nativeBodyDeadline: 'passed', pendingKeyboardAndSemanticResponse: 'passed', wrongPageReadRecovery: 'passed', explicitReadRecovery: 'passed', templateWrites, streamed, abortedBodies, selectedScans: scans, browserErrors: errors.length, runtime }))
  } finally {
    if (browser) await browser.close()
    proxy.closeAllConnections()
    await new Promise((done) => proxy.close(done))
    if (server.exitCode === null) { const exited = new Promise((done) => server.once('exit', done)); server.kill('SIGTERM'); await exited }
  }
}
