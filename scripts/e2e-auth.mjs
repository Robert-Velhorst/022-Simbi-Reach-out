import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectBrowser } from './e2e-browser.mjs'
import { activate, enter, choose } from './e2e-keyboard-controls.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const engine = selectBrowser(require('playwright'))
const axe = require('axe-core')
const screenshots = resolve(root, '..', 'browser-qa', engine.name)
const runtimeRoot = resolve(root, '.e2e-runtime')
await mkdir(screenshots, { recursive: true }); await mkdir(runtimeRoot, { recursive: true })
const python = process.env.SIMBI_E2E_PYTHON ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const port = process.env.SIMBI_AUTH_E2E_PORT ?? '4179'
assert.ok(/^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535, 'Invalid isolated auth test port')
const origin = `http://127.0.0.1:${port}`
const password = 'Fictional local keyboard password only'
const checkNames = ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process']

for (const locale of ['en', 'nl']) {
  const runtime = await mkdtemp(join(runtimeRoot, `auth-${engine.name}-${locale}-`))
  const token = randomUUID().replaceAll('-', '') // Ephemeral fixture, never a real operator token.
  const catalog = JSON.parse(await readFile(join(root, 'frontend', 'src', 'locales', `${locale}.json`), 'utf8'))
  const t = (key) => { assert.ok(Object.hasOwn(catalog, key), `Missing ${locale} auth key: ${key}`); return catalog[key] }
  const logs = []
  const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', port], {
    cwd: root,
    env: { ...process.env, SIMBI_ENV: 'test', SIMBI_DATABASE_PATH: join(runtime, 'auth.db'), SIMBI_BACKUP_PATH: join(runtime, 'backups'), SIMBI_FRONTEND_ORIGIN: origin, SIMBI_COOKIE_SECURE: 'false', SIMBI_ALLOWED_HOSTS: '127.0.0.1', SIMBI_AUTO_BACKUP: 'false', SIMBI_REQUIRE_MAINTENANCE: 'false', SIMBI_SETUP_TOKEN: token, SIMBI_HAI_FEED_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  let browser
  try {
    const deadline = Date.now() + 60_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      assert.equal(server.exitCode, null, 'Owned auth server exited before binding')
      // Health on someone else's listener never authorizes fixture writes.
      if (logs.join('').includes(`Uvicorn running on ${origin}`)) {
        try { ready = (await fetch(`${origin}/api/health/ready`)).ok } catch { /* Startup only. */ }
      }
      if (!ready) await new Promise((done) => setTimeout(done, 250))
    }
    assert.ok(ready, `Owned isolated auth server did not become ready: ${logs.join('')}`)
    browser = await engine.type.launch({ headless: true })
    const mobile = locale === 'nl'
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, bypassCSP: true })
    const errors = []; const writes = []; const rejected = []
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      errors.push('Unexpected external auth request'); return route.abort('blockedbyclient')
    })
    await context.addInitScript(() => {
      window.authKeyboardProof = { pointer: 0, keys: 0 }
      document.addEventListener('pointerdown', () => window.authKeyboardProof.pointer++)
      document.addEventListener('keydown', () => window.authKeyboardProof.keys++)
    })
    const page = await context.newPage()
    const expectedFailures = new Map([['/api/auth/setup', 403], ['/api/auth/login', 401], ['/api/me', 401]])
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) rejected.push([new URL(response.url()).pathname, response.status()])
    })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return
      const url = message.location().url
      if (url?.startsWith(origin)) {
        const status = expectedFailures.get(new URL(url).pathname)
        if (status && message.text().includes(String(status))) return
      }
      errors.push(message.text())
    })
    let scans = 0
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    const read = async (path) => { const result = await page.request.get(`${origin}/api${path}`); assert.ok(result.ok(), `Auth read failed: ${path}`); return result.json() }
    const capture = async (state) => {
      assert.equal(new URL(page.url()).origin, origin)
      assert.ok((await page.title()).includes('Simbi'))
      assert.ok((await page.locator('main').textContent()).trim())
      assert.equal(await page.locator('vite-error-overlay').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.addScriptTag({ content: axe.source })
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })))
      assert.deepEqual(violations, [], `${locale}/${state} auth accessibility`)
      scans++
      await page.screenshot({ path: join(screenshots, `simbi-auth-${locale}-${state}.png`), fullPage: false })
    }
    const navigate = async (label, path) => {
      if (mobile) { await activate(page, button('Open navigation')); await page.getByRole('dialog', { name: t('Primary navigation') }).waitFor() }
      await activate(page, page.getByRole('link', { name: t(label), exact: true }))
      await page.waitForURL(`${origin}${path}`); await page.waitForLoadState('networkidle')
    }
    await page.goto(origin, { waitUntil: 'networkidle' })
    assert.equal((await read('/auth/status')).setup_required, true)
    await choose(page, page.getByRole('combobox', { name: 'Language / Taal' }), locale)
    assert.equal(await page.locator('html').getAttribute('lang'), locale)
    const setup = button('Create workspace')
    await activate(page, setup)
    assert.equal(writes.length, 0)
    assert.ok(await page.locator('[name=setup_token]').evaluate((element) => element === document.activeElement && !element.validity.valid))
    const ownerName = `Fictional keyboard owner ${locale}`
    const workspaceName = `Fictional keyboard workspace ${locale}`
    const email = `keyboard-${locale}@example.test`
    await enter(page, page.locator('[name=setup_token]'), 'wrong-fictional-bootstrap-token')
    await enter(page, page.locator('[name=display_name]'), ownerName)
    await enter(page, page.locator('[name=workspace_name]'), workspaceName)
    await enter(page, page.locator('[name=email]'), email)
    await enter(page, page.locator('[name=password]'), 'short')
    await activate(page, setup)
    assert.equal(writes.length, 0)
    assert.ok(await page.locator('[name=password]').evaluate((element) => element === document.activeElement && !element.validity.valid))
    await enter(page, page.locator('[name=password]'), password)
    const refusedSetup = page.waitForResponse((response) => response.url() === `${origin}/api/auth/setup` && response.status() === 403)
    await activate(page, setup); await refusedSetup
    await page.getByRole('status').waitFor()
    assert.equal((await read('/auth/status')).setup_required, true)
    for (const [name, value] of Object.entries({ display_name: ownerName, workspace_name: workspaceName, email, password })) assert.equal(await page.locator(`[name=${name}]`).inputValue(), value)
    await capture('setup-refused')
    await enter(page, page.locator('[name=setup_token]'), token)
    await activate(page, setup)
    await page.getByRole('main', { name: t('Main content') }).waitFor()
    await page.waitForLoadState('networkidle')
    const owner = await read('/me')
    assert.equal(owner.display_name, ownerName); assert.equal(owner.workspace_name, workspaceName); assert.equal(owner.email, email); assert.equal(owner.role, 'owner'); assert.equal(owner.compliance_ack_at, null)
    const before = await read('/export')
    await navigate('Settings', '/settings')
    assert.equal((await read('/settings')).members.length, 1)
    const acknowledge = button('Record acknowledgement')
    await activate(page, acknowledge)
    assert.ok(await page.locator(`[name=${checkNames[0]}]`).evaluate((element) => element === document.activeElement && !element.validity.valid))
    assert.equal(writes.length, 2)
    for (const name of checkNames) await activate(page, page.locator(`[name=${name}]`), 'Space')
    await page.route(`${origin}/api/settings/compliance`, async (route) => {
      const result = await route.fetch()
      await new Promise((done) => setTimeout(done, 1500))
      await route.fulfill({ response: result })
    })
    await activate(page, acknowledge)
    assert.ok(await button('Recording acknowledgement…').isDisabled())
    await page.keyboard.press('Enter') // Actual repeated key while the first confirmation is pending.
    await capture('compliance-pending')
    await page.getByText(t('Compliance acknowledgement recorded in the audit log.'), { exact: true }).waitFor()
    assert.ok(await acknowledge.evaluate((element) => element === document.activeElement), 'Completed confirmation must retain or restore its submitting-control focus')
    await page.unroute(`${origin}/api/settings/compliance`)
    const confirmed = await read('/export')
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) {
      assert.ok(Array.isArray(confirmed[table]) && Array.isArray(before[table]))
      assert.deepEqual(confirmed[table], before[table])
    }
    assert.deepEqual(confirmed.audit_events.filter((event) => before.audit_events.some((old) => old.id === event.id)), before.audit_events)
    assert.equal(confirmed.audit_events.filter((event) => event.event_type === 'compliance.acknowledged').length, 1)
    assert.ok((await read('/me')).compliance_ack_at)
    if (mobile) await activate(page, button('Open navigation'))
    await activate(page, button('Sign out'))
    const signIn = button('Sign in')
    await signIn.waitFor()
    assert.equal(await page.locator('html').getAttribute('lang'), locale)
    await activate(page, signIn)
    assert.equal(writes.length, 4)
    assert.ok(await page.locator('[name=email]').evaluate((element) => element === document.activeElement && !element.validity.valid))
    await enter(page, page.locator('[name=email]'), email)
    await enter(page, page.locator('[name=password]'), 'wrong fictional password')
    const refusedLogin = page.waitForResponse((response) => response.url() === `${origin}/api/auth/login` && response.status() === 401)
    await activate(page, signIn); await refusedLogin; await page.getByRole('status').waitFor()
    assert.equal(await page.locator('[name=email]').inputValue(), email)
    assert.equal(await page.locator('[name=password]').inputValue(), 'wrong fictional password')
    await capture('login-refused')
    await enter(page, page.locator('[name=password]'), password)
    await activate(page, signIn)
    await page.getByRole('main', { name: t('Main content') }).waitFor()
    await page.waitForLoadState('networkidle')
    const restored = await read('/me')
    assert.equal(restored.user_id, owner.user_id); assert.equal(restored.workspace_id, owner.workspace_id); assert.equal(restored.compliance_ack_at, (await read('/settings')).workspace.compliance_ack_at)
    assert.equal((await read('/settings')).members.length, 1)
    assert.deepEqual(writes, ['POST /api/auth/setup', 'POST /api/auth/setup', 'POST /api/settings/compliance', 'POST /api/auth/logout', 'POST /api/auth/login', 'POST /api/auth/login'])
    assert.deepEqual(rejected, [['/api/auth/setup', 403], ['/api/me', 401], ['/api/auth/login', 401]])
    const proof = await page.evaluate(() => window.authKeyboardProof)
    assert.equal(proof.pointer, 0); assert.ok(proof.keys > 25)
    assert.equal(scans, 3); assert.deepEqual(errors, [])
    const stored = await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) }))
    assert.ok(!JSON.stringify(stored).includes(password) && !JSON.stringify(stored).includes(token))
    console.log(JSON.stringify({ browserEngine: engine.name, browserVersion: browser.version(), locale, viewport: mobile ? '390x844' : '1440x1000', keyboardBootstrap: 'passed', setupTokenGate: 'passed', nativeValidationNoWrite: 'passed', complianceRepeatGuardAndOneAudit: 'passed', logoutBadLoginAndSameOwnerRecovery: 'passed', uiRequests: writes.length, expectedRejectedResponses: rejected.length, pointerActions: proof.pointer, selectedScans: scans, browserErrors: errors.length, runtime }))
  } finally {
    if (browser) await browser.close()
    const exited = new Promise((done) => server.once('exit', done))
    if (server.exitCode === null) { server.kill('SIGTERM'); await exited }
  }
}
