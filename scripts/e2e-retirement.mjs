import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectBrowser } from './e2e-browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const engine = selectBrowser(require('playwright'))
const screenshots = resolve(root, '..', 'browser-qa', engine.name)
await mkdir(screenshots, { recursive: true })
const axe = require('axe-core')
const python = process.env.SIMBI_E2E_PYTHON ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const port = process.env.SIMBI_RETIREMENT_E2E_PORT ?? '4178'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid isolated retirement test port')
const origin = `http://127.0.0.1:${port}`
const runtimeRoot = resolve(root, '.e2e-runtime')
await mkdir(runtimeRoot, { recursive: true })
const PASSPHRASE = 'correct horse battery staple' // Isolated fictional owner only.

for (const locale of ['en', 'nl']) {
  const runtime = await mkdtemp(join(runtimeRoot, `retirement-${engine.name}-${locale}-`))
  const catalog = JSON.parse(await readFile(join(root, 'frontend', 'src', 'locales', `${locale}.json`), 'utf8'))
  const t = (key) => { assert.ok(catalog[key], `Missing ${locale} translation: ${key}`); return catalog[key] }
  const logs = []
  const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', port], {
    cwd: root,
    env: { ...process.env, SIMBI_ENV: 'test', SIMBI_DATABASE_PATH: join(runtime, 'retirement.db'), SIMBI_BACKUP_PATH: join(runtime, 'backups'), SIMBI_FRONTEND_ORIGIN: origin, SIMBI_COOKIE_SECURE: 'false', SIMBI_ALLOWED_HOSTS: '127.0.0.1', SIMBI_AUTO_BACKUP: 'false', SIMBI_REQUIRE_MAINTENANCE: 'false', SIMBI_SETUP_TOKEN: '', SIMBI_HAI_FEED_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  let browser
  try {
    const deadline = Date.now() + 60_000
    let ready = false
    while (Date.now() < deadline && !ready) {
      if (server.exitCode !== null) throw new Error(`Isolated server exited: ${logs.join('')}`)
      // Do not send fixture writes to an unrelated server that already owns
      // this port. Readiness belongs to OUR child only after its successful bind.
      if (logs.join('').includes(`Uvicorn running on ${origin}`)) {
        try { ready = (await fetch(`${origin}/api/health/ready`)).ok } catch { /* Startup only. */ }
      }
      if (!ready) await new Promise((done) => setTimeout(done, 250))
    }
    assert.ok(ready, 'Isolated retirement server did not become ready')
    browser = await engine.type.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, bypassCSP: true })
    const errors = []
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      errors.push('Unexpected external request'); return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    let interrupted = false
    page.on('console', (message) => { if (message.type() === 'error' && !(interrupted && message.location().url.includes('/api/privacy/retirement/confirm'))) errors.push(message.text()) })
    async function post(path, data) {
      const csrf = (await context.cookies(origin)).find(({ name }) => name === 'simbi_csrf')?.value
      const result = await page.request.post(`${origin}/api${path}`, { headers: csrf ? { 'X-CSRF-Token': csrf } : {}, data })
      assert.ok(result.ok(), `${path}: ${await result.text()}`)
      return result.json()
    }
    await post('/auth/setup', { display_name: 'Fictional Personal Owner', workspace_name: 'Fictional Personal Workspace', email: 'retirement@example.test', password: PASSPHRASE })
    const campaign = await post('/campaigns', { name: 'Fictional Personal Campaign', purpose: 'Isolated retirement verification only', lawful_basis: 'Fictional fixture; no provider operation' })
    const prospect = await post('/prospects', { name: 'Fictional Private Contact', source_url: `https://simbi.com/fictional-retirement-${locale}` })
    const template = await post('/templates', { name: 'Fictional Personal Template', body: 'Hello {name}, fictional content for an isolated test, never a message to send.' })
    await post('/drafts', { campaign_id: campaign.id, prospect_id: prospect.id, template_id: template.id })
    await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
    assert.ok(page.url().startsWith(origin) && (await page.title()).includes('Simbi'), 'Wrong application identity')
    await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption(locale)
    const button = (key) => page.getByRole('button', { name: t(key), exact: true })
    assert.ok(await button('Preview personal retirement').isDisabled())
    await button('Enable safety stop').click()
    await button('Preview personal retirement').click()
    await page.getByRole('heading', { name: t('Personal retirement preview') }).waitFor()
    const before = await (await page.request.get(`${origin}/api/export`)).json()
    const sibling = await context.newPage()
    sibling.on('pageerror', (error) => errors.push(error.message))
    await sibling.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
    await button('Review personal retirement').click()
    let dialog = page.getByRole('dialog', { name: t('Confirm personal retirement') })
    await dialog.waitFor()
    assert.ok(await dialog.getByRole('button', { name: t('Retire this installation'), exact: true }).isDisabled())
    await dialog.getByLabel(t('Local account password')).fill(PASSPHRASE)
    await dialog.getByLabel(t('Type RETIRE to confirm')).fill('RETIRE')
    for (const box of await dialog.getByRole('checkbox').all()) await box.check()
    await page.screenshot({ path: join(screenshots, `simbi-retirement-${locale}-desktop.png`) })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await button('Review personal retirement').evaluate((element) => document.activeElement === element))
    const afterCancel = await (await page.request.get(`${origin}/api/export`)).json()
    for (const table of ['campaigns', 'prospects', 'templates', 'drafts', 'handoffs', 'replies', 'reminders', 'suppressions']) assert.deepEqual(afterCancel[table], before[table], `Cancel mutated ${table}`)
    await button('Review personal retirement').click()
    dialog = page.getByRole('dialog', { name: t('Confirm personal retirement') })
    assert.equal(await dialog.getByLabel(t('Local account password')).inputValue(), '')
    assert.equal(await dialog.getByLabel(t('Type RETIRE to confirm')).inputValue(), '')
    for (const box of await dialog.getByRole('checkbox').all()) assert.equal(await box.isChecked(), false)
    await page.setViewportSize({ width: 390, height: 450 })
    assert.ok(await dialog.evaluate((element) => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1 }))
    await page.addScriptTag({ content: axe.source })
    const findings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
    assert.equal(findings.violations.length, 0, JSON.stringify(findings.violations.map(({ id }) => id)))
    await page.screenshot({ path: join(screenshots, `simbi-retirement-${locale}-mobile.png`) })
    let receipt
    if (locale === 'nl') {
      // Real isolated commit succeeds, but the browser never receives its body.
      await page.route('**/api/privacy/retirement/confirm', async (route) => {
        const response = await route.fetch(); assert.ok(response.ok())
        receipt = await response.json(); interrupted = true
        await route.abort('failed')
      })
    } else {
      page.on('response', async (response) => { if (response.url().endsWith('/api/privacy/retirement/confirm') && response.ok()) receipt = await response.json() })
    }
    for (const box of await dialog.getByRole('checkbox').all()) await box.check()
    await dialog.getByLabel(t('Type RETIRE to confirm')).fill('RETIRE')
    await dialog.getByLabel(t('Local account password')).fill(PASSPHRASE)
    await dialog.getByRole('button', { name: t('Retire this installation'), exact: true }).click()
    await page.getByRole('heading', { name: t('Local installation retired') }).waitFor()
    assert.ok(await page.getByRole('heading', { name: t('Local installation retired') }).evaluate((element) => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.activeElement === element }), 'Retired heading must be visible and focused after Settings is removed')
    await sibling.getByRole('heading', { name: t('Local installation retired') }).waitFor()
    assert.ok(receipt?.backup_file && receipt.counts.users === 1 && receipt.counts.workspaces === 1 && receipt.counts.prospects === 1)
    assert.equal((await context.cookies(origin)).filter(({ name }) => ['simbi_session', 'simbi_csrf'].includes(name)).length, 0)
    assert.equal((await page.request.get(`${origin}/api/me`)).status(), 401)
    assert.equal((await page.request.post(`${origin}/api/auth/setup`, { data: { display_name: 'Fictional Replacement', workspace_name: 'Fictional Replacement', email: 'replacement@example.test', password: PASSPHRASE } })).status(), 409)
    const replay = await (await page.request.get(`${origin}/api/privacy/retirement/receipt/${receipt.plan_id}`)).json()
    assert.ok(replay.replayed); assert.deepEqual(replay.counts, receipt.counts)
    await page.screenshot({ path: join(screenshots, `simbi-retired-${locale}.png`) })
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: t('Local installation retired') }).waitFor()
    assert.equal(await page.getByText('Fictional Personal Owner', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: t('Sign in'), exact: true }).count(), 0)
    await page.addScriptTag({ content: axe.source })
    const retiredFindings = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
    assert.equal(retiredFindings.violations.length, 0, JSON.stringify(retiredFindings.violations.map(({ id }) => id)))
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ browserEngine: engine.name, browserVersion: browser.version(), locale, runtime, screenshotDirectory: screenshots, counts: receipt.counts, interruptedResponseRecovered: locale === 'nl', crossTabRetired: true, browserErrors: errors.length, accessibilityViolations: findings.violations.length + retiredFindings.violations.length }))
  } finally {
    await browser?.close()
    const exited = new Promise((done) => server.once('exit', done))
    if (server.exitCode === null) server.kill('SIGTERM')
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
}
