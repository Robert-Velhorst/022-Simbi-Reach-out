import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectBrowser } from './e2e-browser.mjs'
import { activate, choose, enter } from './e2e-keyboard-controls.mjs'

// Fresh fictional installations only. Real local commits precede damaged/lost
// responses; this is not a provider login, owner-password change or delivery test.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const engine = selectBrowser(require('playwright'))
const axe = require('axe-core')
const screenshots = resolve(root, '..', 'browser-qa', engine.name)
const runtimeRoot = resolve(root, '.e2e-runtime')
await mkdir(screenshots, { recursive: true }); await mkdir(runtimeRoot, { recursive: true })
const python = process.env.SIMBI_E2E_PYTHON ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const port = process.env.SIMBI_PASSWORD_E2E_PORT ?? '4181'
assert.ok(/^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535, 'Invalid isolated password test port')
const origin = `http://127.0.0.1:${port}`
const unknownKey = 'The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'
const recoveryKey = 'Your local password change is not confirmed. It may have signed out your sessions. Do not repeat it here. Use Sign in again to check the new password first, then the previous password if needed. Leaving this page clears these password fields.'
const pendingKey = 'A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.'
const recordTables = ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']

for (const locale of ['en', 'nl']) {
  const runtime = await mkdtemp(join(runtimeRoot, `password-${engine.name}-${locale}-`))
  const token = randomUUID().replaceAll('-', '')
  const secrets = Array.from({ length: 4 }, () => randomUUID())
  const email = `password-${locale}@example.test`
  const catalog = JSON.parse(await readFile(join(root, 'frontend', 'src', 'locales', `${locale}.json`), 'utf8'))
  const t = (key) => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} password key`); return catalog[key] }
  const logs = []
  const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', port], {
    cwd: root,
    env: { ...process.env, SIMBI_ENV: 'test', SIMBI_DATABASE_PATH: join(runtime, 'password.db'), SIMBI_BACKUP_PATH: join(runtime, 'backups'), SIMBI_FRONTEND_ORIGIN: origin, SIMBI_COOKIE_SECURE: 'false', SIMBI_ALLOWED_HOSTS: '127.0.0.1', SIMBI_AUTO_BACKUP: 'false', SIMBI_REQUIRE_MAINTENANCE: 'false', SIMBI_SETUP_TOKEN: token, SIMBI_HAI_FEED_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  let browser, releaseRefusal
  try {
    const deadline = Date.now() + 60_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      assert.equal(server.exitCode, null, 'Owned password server exited before binding')
      if (logs.join('').includes(`Uvicorn running on ${origin}`)) {
        try { ready = (await fetch(`${origin}/api/health/ready`)).ok } catch { /* Owned startup only. */ }
      }
      if (!ready) await new Promise((done) => setTimeout(done, 250))
    }
    assert.ok(ready, 'Owned isolated password server did not become ready')
    browser = await engine.type.launch({ headless: true })
    const mobile = locale === 'nl'
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, bypassCSP: true })
    const errors = [], writes = []
    let lostResponses = 0, scans = 0
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      errors.push('Unexpected external password-test request'); return route.abort('blockedbyclient')
    })
    await context.addInitScript(() => {
      window.passwordKeyboardProof = { pointer: 0, keys: 0 }
      document.addEventListener('pointerdown', () => window.passwordKeyboardProof.pointer++)
      document.addEventListener('keydown', () => window.passwordKeyboardProof.keys++)
    })
    const page = await context.newPage()
    const expectedFailures = new Map([['/api/auth/password', 403], ['/api/auth/login', 401], ['/api/me', 401]])
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`) })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return
      const url = message.location().url
      if (url?.startsWith(origin)) {
        const path = new URL(url).pathname
        if (expectedFailures.has(path) && message.text().includes(String(expectedFailures.get(path)))) return
        if (path === '/api/auth/password' && lostResponses === 1 && /net::ERR_FAILED|NetworkError|Load failed|Failed to load resource/i.test(message.text())) return
      }
      errors.push(message.text())
    })
    const read = async (path) => { const result = await page.request.get(`${origin}/api${path}`); assert.ok(result.ok(), `Password fixture read failed: ${path}`); return result.json() }
    const fixturePost = async (path, data) => {
      const csrf = (await context.cookies(origin)).find((item) => item.name === 'simbi_csrf')?.value ?? ''
      const result = await page.request.post(`${origin}/api${path}`, { data, headers: { Origin: origin, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': randomUUID() } })
      assert.ok(result.ok(), `Fictional fixture preparation failed: ${path}`); return result.json()
    }
    await fixturePost('/auth/setup', { setup_token: token, display_name: 'Fictional password owner', workspace_name: 'Fictional password workspace', email, password: secrets[0] })
    await fixturePost('/campaigns', { name: 'Fictional preserved campaign', purpose: 'Preserve local records during password recovery', lawful_basis: 'Fictional local test only' })
    await fixturePost('/prospects', { name: 'Fictional preserved contact', source_url: 'https://simbi.com/fictional-password-fixture', notes: 'Fictional manually supplied record' })
    await fixturePost('/templates', { name: 'Fictional preserved template', subject: 'Fictional subject', body: 'Fictional manually reviewed message for local tests only.' })
    const owner = await read('/me')
    const before = await read('/export')
    for (const table of ['campaigns', 'prospects', 'templates']) assert.equal(before[table].length, 1)
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    const current = () => page.getByLabel(t('Current password'), { exact: true })
    const next = () => page.getByLabel(t('New password'), { exact: true })
    const passwordWrites = () => writes.filter((item) => item === 'POST /api/auth/password').length
    const capture = async (state) => {
      assert.equal(new URL(page.url()).origin, origin)
      assert.ok((await page.title()).includes('Simbi'))
      assert.ok((await page.locator('main').textContent()).trim())
      assert.equal(await page.locator('vite-error-overlay').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.addScriptTag({ content: axe.source })
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id }) => id))
      assert.deepEqual(violations, [], `${locale}/${state} password accessibility`); scans++
      await page.screenshot({ path: join(screenshots, `simbi-password-${locale}-${state}.png`), fullPage: false })
    }
    const settings = async () => {
      await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
      await current().waitFor()
      assert.equal(await current().inputValue(), '')
      assert.equal(await next().inputValue(), '')
      assert.ok(await button('Change password').isEnabled())
    }
    const signIn = async (secret, refusePrevious = false) => {
      const link = page.getByRole('link', { name: t('Sign in again'), exact: true })
      await activate(page, link)
      await button('Sign in').waitFor()
      assert.equal(await current().count(), 0)
      assert.equal(await page.locator('[name=password]').inputValue(), '')
      await enter(page, page.locator('[name=email]'), email)
      if (refusePrevious) {
        await enter(page, page.locator('[name=password]'), secrets[0])
        const refused = page.waitForResponse((result) => result.url() === `${origin}/api/auth/login` && result.status() === 401)
        await activate(page, button('Sign in')); await refused
        await page.getByRole('status').waitFor()
      }
      await enter(page, page.locator('[name=password]'), secret)
      await activate(page, button('Sign in'))
      await page.getByRole('main', { name: t('Main content') }).waitFor()
      await page.waitForLoadState('networkidle')
      const recovered = await read('/me')
      assert.equal(recovered.user_id, owner.user_id); assert.equal(recovered.workspace_id, owner.workspace_id)
      assert.equal(recovered.email, owner.email); assert.equal(recovered.role, 'owner')
    }
    await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
    await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
    await current().waitFor()
    await enter(page, current(), secrets[0]); await enter(page, next(), 'short')
    await activate(page, button('Change password'))
    assert.equal(passwordWrites(), 0)
    assert.ok(await next().evaluate((element) => element === document.activeElement && !element.validity.valid))
    await enter(page, current(), 'wrong fictional current password'); await enter(page, next(), secrets[1])
    const heldRefusal = new Promise((done) => { releaseRefusal = done })
    await page.route(`${origin}/api/auth/password`, async (route) => {
      const result = await route.fetch(); assert.equal(result.status(), 403)
      await heldRefusal; await route.fulfill({ response: result })
    })
    await activate(page, button('Change password'))
    await page.getByText(t(pendingKey), { exact: true }).waitFor()
    assert.ok(await current().isDisabled()); assert.ok(await next().isDisabled()); assert.ok(await button('Change password').isDisabled())
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
    assert.equal(passwordWrites(), 1)
    await capture('refusal-pending')
    releaseRefusal(); releaseRefusal = null
    await page.getByText(t('The current password is incorrect'), { exact: true }).waitFor()
    assert.ok(await button('Change password').isEnabled())
    assert.equal(await current().inputValue(), 'wrong fictional current password'); assert.equal(await next().inputValue(), secrets[1])
    assert.equal((await read('/export')).audit_events.filter((item) => item.event_type === 'account.password_changed').length, 0)
    await capture('refused-correctable')
    await page.unroute(`${origin}/api/auth/password`)

    for (const [index, mode] of ['contradictory', 'lost'].entries()) {
      if (index) await settings()
      await enter(page, current(), secrets[index]); await enter(page, next(), secrets[index + 1])
      await page.evaluate(() => { window.passwordOriginalFields = [document.querySelector('[name=current_password]'), document.querySelector('[name=new_password]')] })
      const sibling = await browser.newContext()
      const siblingLogin = await sibling.request.post(`${origin}/api/auth/login`, { data: { email, password: secrets[index] } })
      assert.ok(siblingLogin.ok(), 'Fictional independent session setup failed')
      assert.ok((await sibling.request.get(`${origin}/api/me`)).ok())
      await page.route(`${origin}/api/auth/password`, async (route) => {
        const result = await route.fetch()
        assert.equal(result.status(), 200)
        assert.deepEqual(await result.json(), { changed: true, reauthenticate: true })
        if (mode === 'lost') { lostResponses++; await route.abort('failed') }
        else await route.fulfill({ response: result, json: { changed: true, reauthenticate: false } })
      })
      await activate(page, button('Change password'))
      await page.getByText(t(unknownKey), { exact: true }).waitFor()
      await page.getByText(t(recoveryKey), { exact: true }).waitFor()
      assert.equal(await page.getByText(t('Password changed'), { exact: true }).count(), 0)
      assert.equal(await page.getByText(t('All your sessions have been signed out. Sign in with your new password to continue.'), { exact: true }).count(), 0)
      assert.ok(await current().isDisabled()); assert.ok(await next().isDisabled()); assert.ok(await button('Change password').isDisabled())
      assert.equal(await current().inputValue(), secrets[index]); assert.equal(await next().inputValue(), secrets[index + 1])
      assert.ok(await page.evaluate(() => window.passwordOriginalFields.every((element) => element.isConnected) && window.passwordOriginalFields[0] === document.querySelector('[name=current_password]') && window.passwordOriginalFields[1] === document.querySelector('[name=new_password]')))
      const count = passwordWrites()
      await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
      assert.equal(passwordWrites(), count)
      assert.equal((await page.request.get(`${origin}/api/me`)).status(), 401)
      assert.equal((await sibling.request.get(`${origin}/api/me`)).status(), 401)
      await sibling.close()
      await capture(`${mode}-uncertain`)
      await page.unroute(`${origin}/api/auth/password`)
      await signIn(secrets[index + 1], index === 0)
      const confirmed = await read('/export')
      for (const table of recordTables) assert.deepEqual(confirmed[table], before[table])
      assert.deepEqual(confirmed.audit_events.filter((event) => before.audit_events.some((old) => old.id === event.id)), before.audit_events)
      assert.equal(confirmed.audit_events.filter((item) => item.event_type === 'account.password_changed').length, index + 1)
      await settings(); await capture(`${mode}-recovered`)
    }
    await enter(page, current(), secrets[2]); await enter(page, next(), secrets[3])
    await activate(page, button('Change password'))
    await page.getByText(t('Password changed'), { exact: true }).waitFor()
    await page.getByText(t('All your sessions have been signed out. Sign in with your new password to continue.'), { exact: true }).waitFor()
    assert.equal(await current().count(), 0); assert.equal(await next().count(), 0)
    await capture('verified-change')
    await signIn(secrets[3])
    const final = await read('/export')
    for (const table of recordTables) assert.deepEqual(final[table], before[table])
    assert.deepEqual(final.audit_events.filter((event) => before.audit_events.some((old) => old.id === event.id)), before.audit_events)
    assert.equal(final.audit_events.filter((item) => item.event_type === 'account.password_changed').length, 3)
    assert.equal(passwordWrites(), 4)
    assert.equal(writes.filter((item) => item === 'POST /api/auth/login').length, 4)
    assert.equal(writes.length, 8)
    assert.equal(lostResponses, 1); assert.equal(scans, 7); assert.deepEqual(errors, [])
    const proof = await page.evaluate(() => window.passwordKeyboardProof)
    assert.equal(proof.pointer, 0); assert.ok(proof.keys > 0)
    const stored = await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) }))
    for (const secret of [...secrets, token]) assert.ok(!JSON.stringify(stored).includes(secret))
    console.log(JSON.stringify({ browserEngine: engine.name, browserVersion: browser.version(), locale, viewport: mobile ? '390x844' : '1440x1000', nativeValidationNoWrite: 'passed', pendingRepeatAndPreWriteRefusal: 'passed', realCommittedContradictoryAndLostResponses: 'passed', originalPasswordFieldsRetained: 'passed', deliberateSameOwnerReauthentication: 'passed', independentSessionRevocation: 'passed', priorRecordsAndAuditPreserved: 'passed', uiPasswordRequests: passwordWrites(), committedPasswordChanges: 3, uiLoginRequests: 4, selectedScans: scans, pointerActions: proof.pointer, browserErrors: errors.length, runtime }))
  } finally {
    if (releaseRefusal) releaseRefusal()
    if (browser) await browser.close()
    const exited = new Promise((done) => server.once('exit', done))
    if (server.exitCode === null) { server.kill('SIGTERM'); await exited }
  }
}
