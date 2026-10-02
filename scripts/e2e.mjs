import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bilingualWorkflow } from './e2e-locales.mjs'
import { privacyWorkflow } from './e2e-privacy.mjs'
import { auditPrivacyWorkflow } from './e2e-audit-privacy.mjs'
import { selectBrowser } from './e2e-browser.mjs'
import { retentionPagesWorkflow } from './e2e-retention-pages.mjs'
import { navigationWorkflow } from './e2e-navigation.mjs'
import { draftSaveWorkflow } from './e2e-draft-save.mjs'
import { keyboardOutreachWorkflow } from './e2e-keyboard-workflow.mjs'
import { conversationRecordsWorkflow } from './e2e-conversation-records.mjs'
import { reminderReplayWorkflow } from './e2e-reminder-replay.mjs'
import { creationReplayWorkflow } from './e2e-creation-replay.mjs'
import { pageRecordsWorkflow } from './e2e-page-records.mjs'
import { operationalReadsWorkflow } from './e2e-operational-reads.mjs'
import { safetyMutationsWorkflow } from './e2e-safety-mutations.mjs'
import { providerInputRecoveryWorkflow } from './e2e-provider-input.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const axe = require('axe-core')
const engine = selectBrowser(require('playwright'))
const screenshots = resolve(root, '..', 'browser-qa', engine.name)
await mkdir(screenshots, { recursive: true })
const runtimeRoot = resolve(root, '.e2e-runtime')
if (dirname(runtimeRoot) !== root || !runtimeRoot.endsWith('.e2e-runtime')) {
  throw new Error(`Unsafe E2E runtime path: ${runtimeRoot}`)
}
await mkdir(runtimeRoot, { recursive: true })
const runtime = await mkdtemp(join(runtimeRoot, `run-${engine.name}-`))

const python = process.env.SIMBI_E2E_PYTHON
  ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const port = process.env.SIMBI_E2E_PORT ?? '4173'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('SIMBI_E2E_PORT must be an unprivileged port between 1024 and 65535')
const origin = `http://127.0.0.1:${port}`
const serverOutput = []
const server = spawn(python, [
  '-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', port,
], {
  cwd: root,
  env: {
    ...process.env,
    SIMBI_ENV: 'test',
    SIMBI_DATABASE_PATH: join(runtime, 'simbi-e2e.db'),
    SIMBI_BACKUP_PATH: join(runtime, 'cleanup-backups'),
    SIMBI_FRONTEND_ORIGIN: origin,
    SIMBI_COOKIE_SECURE: 'false',
    SIMBI_ALLOWED_HOSTS: '127.0.0.1',
    SIMBI_AUTO_BACKUP: 'false',
    SIMBI_REQUIRE_MAINTENANCE: 'false',
    SIMBI_SETUP_TOKEN: '',
    SIMBI_HAI_FEED_PATH: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()))
server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()))

async function waitUntilReady() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`E2E server exited early:\n${serverOutput.join('')}`)
    // Health from a different listener is not evidence that OUR child owns the port.
    if (!serverOutput.join('').includes(`Uvicorn running on ${origin}`)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      continue
    }
    try {
      const response = await fetch(`${origin}/api/health/ready`)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`E2E server did not become ready:\n${serverOutput.join('')}`)
}

let browser
try {
  await waitUntilReady()
  browser = await engine.type.launch({ headless: true })
  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    bypassCSP: true,
  })
  const page = await ownerContext.newPage()
  const browserErrors = []
  // These are fictional local workflow records, never evidence of provider delivery.
  async function guardContext(context) {
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      browserErrors.push(`Unexpected external request: ${new URL(route.request().url()).origin}`)
      return route.abort('blockedbyclient')
    })
  }
  await guardContext(ownerContext)
  let signedOutProbeExpected = false
  let signedOutProbes = 0
  let sessionFailureExpected = false
  let sessionFailureProbes = 0
  let expectedDataFailurePath = ''
  let dataFailureProbes = 0
  let cleanupAbortExpected = false
  let cleanupAborts = 0
  let reminderFailureExpected = ''
  let reminderAborts = 0
  let reminderConflicts = 0
  let creationFailurePath = ''
  let creationFailureExpected = ''
  let creationAborts = 0
  let creationConflicts = 0
  page.on('requestfailed', (request) => {
    if (creationFailureExpected === 'abort' && request.url() === creationFailurePath && request.method() === 'POST') creationAborts++
    if (cleanupAbortExpected && request.url() === `${origin}/api/privacy/confirm`) cleanupAborts++
    if (reminderFailureExpected === 'abort' && request.url() === `${origin}/api/reminders` && request.method() === 'POST') reminderAborts++
  })
  // Count HTTP outcomes, not Chromium-specific console diagnostics. Firefox and
  // WebKit need not log failed fetches, and one response can produce many logs.
  page.on('response', (response) => {
    if (creationFailureExpected === 'conflict' && response.url() === creationFailurePath && response.request().method() === 'POST' && response.status() === 409) creationConflicts++
    if (reminderFailureExpected === 'conflict' && response.url() === `${origin}/api/reminders` && response.request().method() === 'POST' && response.status() === 409) reminderConflicts++
    if (expectedDataFailurePath && response.url().startsWith(`${origin}/api${expectedDataFailurePath}`) && response.status() === 503) dataFailureProbes++
    if (sessionFailureExpected && response.url() === `${origin}/api/me` && response.status() === 503) sessionFailureProbes++
    if (signedOutProbeExpected && response.url() === `${origin}/api/me` && response.status() === 401) signedOutProbes++
  })
  page.on('console', (message) => {
    if (message.location().url === creationFailurePath && ((creationFailureExpected === 'abort' && message.text().includes('ERR_FAILED')) || (creationFailureExpected === 'conflict' && message.text().includes('409')))) return
    if (message.location().url === `${origin}/api/reminders` && ((reminderFailureExpected === 'abort' && message.text().includes('ERR_FAILED')) || (reminderFailureExpected === 'conflict' && message.text().includes('409')))) return
    if (cleanupAbortExpected && message.location().url === `${origin}/api/privacy/confirm` && message.text().includes('ERR_FAILED')) return
    if (expectedDataFailurePath && message.location().url.startsWith(`${origin}/api${expectedDataFailurePath}`)
      && message.text().includes('503')) return
    if (sessionFailureExpected && message.location().url === `${origin}/api/me`
      && message.text().includes('503')) return
    if (signedOutProbeExpected && message.location().url === `${origin}/api/me`
      && message.text().includes('401')) return
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`))

  await page.goto(origin, { waitUntil: 'load' })
  if (!(await page.title()).includes('Simbi') || !page.url().startsWith(origin)) {
    throw new Error('Unexpected application identity')
  }
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('nl')
  await page.getByRole('heading', { name: 'Maak je lokale werkruimte aan' }).waitFor()
  await page.locator('[name=display_name]').fill('Production QA')
  await page.locator('[name=workspace_name]').fill('Production QA workspace')
  await page.locator('[name=email]').fill('qa@example.test')
  await page.locator('[name=password]').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Werkruimte aanmaken', exact: true }).click()
  try { await page.getByRole('heading', { name: /Goedemorgen/ }).waitFor() }
  catch (cause) {
    await page.screenshot({ path: join(screenshots, 'simbi-entry-diagnostic.png') })
    console.error(JSON.stringify({ engine: engine.name, runtime, origin, browserErrors, entry: await page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll('h1,h2')].map((item) => item.textContent), notices: [...document.querySelectorAll('[role=status]')].map((item) => item.textContent), busy: [...document.querySelectorAll('[aria-busy=true]')].length, focused: document.hasFocus(), activeTag: document.activeElement?.tagName })) }))
    throw cause
  }
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
  await page.getByRole('heading', { name: /Good morning/ }).waitFor()

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Export workspace JSON' }).waitFor()
  await page.getByRole('link', { name: 'Download redacted support data' }).waitFor()
  await page.getByLabel('Name', { exact: true }).fill('Read-only QA')
  await page.getByLabel('Email', { exact: true }).fill('viewer@example.test')
  await page.getByLabel('Temporary password').fill('isolated viewer QA password')
  await page.getByRole('combobox', { name: 'Role' }).selectOption('viewer')
  await page.getByRole('button', { name: 'Add member' }).click()
  await page.getByText('Local team member added.').waitFor()

  let viewerStorageState
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, bypassCSP: true })
  try {
    await guardContext(viewerContext)
    const viewer = await viewerContext.newPage()
    let viewerSignInExpected = true
    viewer.on('pageerror', (error) => browserErrors.push(`viewer page: ${error.message}`))
    viewer.on('console', (message) => {
      if (viewerSignInExpected && message.location().url === `${origin}/api/me`
        && message.text().includes('401')) return
      if (message.type() === 'error') browserErrors.push(`viewer console: ${message.text()}`)
    })
    await viewer.goto(origin, { waitUntil: 'networkidle' })
    await viewer.getByLabel('Email', { exact: true }).fill('viewer@example.test')
    await viewer.getByLabel('Password', { exact: true }).fill('isolated viewer QA password')
    await viewer.getByRole('button', { name: 'Sign in', exact: true }).click()
    await viewer.getByRole('heading', { name: /Good morning/ }).waitFor()
    viewerSignInExpected = false
    viewerStorageState = await viewerContext.storageState()
    await viewer.getByRole('link', { name: 'Settings' }).click()
    await viewer.getByText(/Ask a workspace owner or admin to export/).waitFor()
    if (await viewer.getByRole('link', { name: 'Export workspace JSON' }).count()
      || await viewer.getByRole('link', { name: 'Download redacted support data' }).count()) {
      throw new Error('Viewer was offered an admin-only download')
    }
    if (!(await viewer.getByRole('button', { name: 'Change password' }).isEnabled())) {
      throw new Error('Viewer lost access to their own password controls')
    }
    if (await viewer.getByRole('button', { name: 'Preview old audit details' }).count()
      || await viewer.getByRole('button', { name: 'Check audit minimization receipts' }).count()) {
      throw new Error('Viewer was offered owner-only audit minimization')
    }
    for (const path of ['/api/export', '/api/support-bundle', '/api/privacy/audit/receipts']) {
      const denied = await viewer.request.get(`${origin}${path}`)
      if (denied.status() !== 403 || (await denied.json()).error?.code !== 'permission_denied') {
        throw new Error(`Viewer restricted-data authorization failed for ${path}`)
      }
    }
    await viewer.screenshot({ path: join(runtime, 'viewer-settings.png'), fullPage: true })
    for (const route of ['Prospects', 'Campaigns', 'Templates', 'Replies', 'Reminders', 'Review queue']) {
      await viewer.getByRole('link', { name: route, exact: true }).click()
      await viewer.getByText(/Your viewer role has read-only access/).waitFor()
      if (await viewer.getByRole('button', { name: /^(Add prospect|Import CSV|New campaign|New template|Record reply|New reminder|Prepare draft|Prepare first draft)$/ }).count()) {
        throw new Error(`Viewer was offered a write action on ${route}`)
      }
    }
    await navigationWorkflow(viewer, origin, axe, screenshots, 'viewer')
  } finally {
    await viewerContext.close()
  }

  // One deliberate local fault proves retry preserves the existing owner session.
  sessionFailureExpected = true
  await page.route(`${origin}/api/me`, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'service_unavailable', message: 'QA: temporary session lookup failure' } }),
  }), { times: 1 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Service unavailable' }).waitFor()
  if (await page.getByLabel('Password', { exact: true }).count()) throw new Error('Service fault requested credentials')
  await page.screenshot({ path: join(runtime, 'session-retry.png'), fullPage: true })
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByRole('heading', { name: 'Settings & safety' }).waitFor()
  await page.getByRole('link', { name: 'Export workspace JSON' }).waitFor()
  sessionFailureExpected = false

  const complianceCheckboxes = page.getByRole('checkbox')
  await complianceCheckboxes.first().waitFor()
  for (let index = 0; index < await complianceCheckboxes.count(); index += 1) {
    await complianceCheckboxes.nth(index).check()
  }
  await page.getByRole('button', { name: 'Record acknowledgement' }).click()
  await page.getByText(/Compliance acknowledgement recorded/).waitFor()

  // Save fictional private URL components through the actual Settings form.
  // Host validation still uses simbi.com; no provider request is made.
  const privateProviderURL = 'https://simbi.com/fictional-private-setting?context=private-query'
  await page.getByLabel('HTTPS base URL', { exact: true }).fill(privateProviderURL)
  await page.getByRole('button', { name: 'Save assisted provider', exact: true }).click()
  await page.getByText('Provider link saved. Assisted mode remains enforced.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('HTTPS base URL', { exact: true }).inputValue(), privateProviderURL)

  await page.getByRole('link', { name: 'Campaigns' }).click()
  await page.getByRole('button', { name: 'New campaign' }).click()
  const campaign = page.getByRole('dialog', { name: 'Create campaign' })
  await campaign.getByRole('textbox', { name: 'Name', exact: true }).fill('Production readiness outreach')
  await campaign.getByRole('textbox', { name: /Purpose/ }).fill('Invite one manually selected member to discuss a relevant collaboration.')
  await campaign.getByRole('textbox', { name: /Lawful basis/ }).fill('Contextual response to a reviewed public offer.')
  await campaign.getByRole('textbox', { name: 'Description' }).fill('Review-gated acceptance workflow.')
  await campaign.getByRole('button', { name: 'Create draft campaign' }).click()
  await page.getByRole('button', { name: 'Activate' }).click()

  await page.getByRole('link', { name: 'Prospects' }).click()
  await page.getByRole('button', { name: 'Add prospect', exact: true }).click()
  const prospect = page.getByRole('dialog', { name: 'Add prospect' })
  await prospect.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex Example')
  await prospect.getByRole('textbox', { name: 'Organization' }).fill('Community Studio')
  await prospect.getByRole('textbox', { name: /Source URL/ }).fill('https://simbi.com/alex-example')
  await prospect.getByRole('combobox', { name: 'Consent context' }).selectOption({ label: 'Contextual request' })
  await prospect.getByRole('textbox', { name: 'Notes' }).fill('Operator-reviewed source context.')
  await prospect.getByRole('button', { name: 'Add prospect' }).click()

  await page.getByRole('link', { name: 'Templates' }).click()
  await page.getByRole('button', { name: 'New template' }).click()
  const template = page.getByRole('dialog', { name: 'Create template' })
  await template.getByRole('textbox', { name: 'Template name' }).fill('Production introduction')
  await template.getByRole('textbox', { name: 'Message body' }).fill('Hello {name}, I noticed your published offer and thought there may be a fit with {campaign}. Your work at {organization} looks relevant. No thanks is completely fine; I will not follow up.')
  await template.getByRole('button', { name: 'Create template' }).click()

  await page.getByRole('link', { name: 'Review queue' }).click()
  await page.getByRole('button', { name: 'Prepare draft' }).click()
  const draft = page.getByRole('dialog', { name: 'Prepare a deterministic draft' })
  await draft.getByRole('combobox', { name: 'Campaign' }).selectOption({ label: 'Production readiness outreach (active)' })
  await draft.getByRole('combobox', { name: 'Prospect' }).selectOption({ label: 'Alex Example — Community Studio' })
  await draft.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Production introduction' })
  await draft.getByRole('button', { name: 'Prepare draft' }).click()
  await page.getByText('100/100', { exact: true }).waitFor()
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Reviewed QA subject')
  if (!(await page.getByRole('button', { name: 'Approve for handoff' }).isDisabled())) {
    throw new Error('Unsaved message changes did not block approval')
  }
  const draftSaveResponse = page.waitForResponse((response) => /\/api\/drafts\/\d+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save and return to review' }).click()
  if ((await draftSaveResponse).status() !== 200) throw new Error('Reviewed QA subject was not saved')
  await page.getByRole('button', { name: 'Save and return to review' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Save and return to review' && button.disabled))
  await page.waitForFunction(() => [...document.querySelectorAll('.approval-box input[type=checkbox]')].every((checkbox) => !checkbox.checked))
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
  await page.getByRole('button', { name: 'Approve for handoff' }).click()
  const handoffResponse = page.waitForResponse((response) => response.url().endsWith('/handoff') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Copy and open provider' }).click()
  const handoffPayload = await (await handoffResponse).json()
  await page.getByRole('button', { name: 'Open provider', exact: true }).waitFor()
  if (handoffPayload.provider_url !== 'https://simbi.com/alex-example' || !handoffPayload.can_open_provider) {
    throw new Error('The assisted handoff did not preserve the approved provider URL')
  }
  await page.waitForFunction(() => [...document.querySelectorAll('dialog button')].some((button) => button.textContent.trim() === 'Open provider' && !button.disabled))
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  if (!(await page.getByRole('button', { name: 'Resolve latest handoff' }).evaluate((button) => button === document.activeElement))) {
    throw new Error('Newly prepared handoff did not restore focus to its replacement action')
  }
  // Recover an interrupted handoff without preparing a second provider action.
  await page.reload({ waitUntil: 'networkidle' })
  const recoveredResponse = page.waitForResponse((response) => response.url().includes('/api/handoffs?') && response.request().method() === 'GET')
  await page.getByRole('button', { name: 'Resolve latest handoff' }).click()
  await page.getByRole('dialog', { name: 'Manual provider handoff' }).waitFor()
  const recovered = (await (await recoveredResponse).json()).items[0]
  if (recovered.provider_url !== 'https://simbi.com/alex-example' || recovered.id !== handoffPayload.id) {
    throw new Error('Recovered handoff lost the original provider link')
  }
  // A real viewer session can inspect the same pending handoff without changing it.
  const historyContext = await browser.newContext({ storageState: viewerStorageState, viewport: { width: 1440, height: 1000 } })
  try {
    await guardContext(historyContext)
    const viewer = await historyContext.newPage()
    viewer.on('pageerror', (error) => browserErrors.push(`viewer history page: ${error.message}`))
    viewer.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`viewer history console: ${message.text()}`)
    })
    await viewer.goto(`${origin}/review`, { waitUntil: 'networkidle' })
    await viewer.getByText(/Your viewer role has read-only access/).waitFor()
    for (const name of ['Subject', 'Message']) {
      if (await viewer.getByRole('textbox', { name, exact: true }).getAttribute('readonly') === null) {
        throw new Error(`Viewer draft ${name} was editable`)
      }
    }
    await viewer.getByRole('button', { name: 'View latest handoff' }).click()
    await viewer.getByRole('dialog', { name: 'Manual provider handoff' }).waitFor()
    if (!(await viewer.getByLabel('Approved message').inputValue()).includes('Reviewed QA subject')) {
      throw new Error('Viewer could not inspect approved handoff content')
    }
    for (const name of ['Copy message', 'Open provider', 'Not sent', 'Sent manually', 'Unsure — needs verification']) {
      if (await viewer.getByRole('button', { name, exact: true }).count()) throw new Error(`Viewer was offered ${name}`)
    }
    const history = await (await viewer.request.get(`${origin}/api/handoffs?draft_id=${handoffPayload.draft_id}&limit=1`)).json()
    if (history.items[0]?.id !== handoffPayload.id || history.items[0]?.can_open_provider !== false) {
      throw new Error('Real viewer handoff permissions did not match the read-only UI')
    }
    async function checkDialogViewport(label) {
      const geometry = await viewer.getByRole('dialog').evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect()
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollY }
      })
      process.stdout.write(`${label} dialog geometry: ${JSON.stringify(geometry)}\n`)
      if (geometry.x < -1 || geometry.y < -1 || geometry.right > geometry.width + 1 || geometry.bottom > geometry.height + 1) {
        throw new Error(`${label} dialog extends outside the visible viewport`)
      }
    }
    await checkDialogViewport('desktop')
    await viewer.screenshot({ path: join(screenshots, 'simbi-viewer-handoff.png'), fullPage: false })
    await viewer.setViewportSize({ width: 390, height: 844 })
    await checkDialogViewport('mobile')
    await viewer.screenshot({ path: join(screenshots, 'simbi-viewer-handoff-mobile.png'), fullPage: false })
    if (!(await viewer.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)))) {
      throw new Error('Opening the dialog left keyboard focus outside it')
    }
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await viewer.keyboard.press(key)
      if (!(await viewer.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)))) {
        const active = await viewer.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }))
        throw new Error(`${key} moved keyboard focus outside the modal: ${JSON.stringify(active)}`)
      }
    }
    await viewer.keyboard.press('Escape')
    await viewer.getByRole('dialog').waitFor({ state: 'hidden' })
    if (!(await viewer.getByRole('button', { name: 'View latest handoff' }).evaluate((button) => button === document.activeElement))) {
      throw new Error('Closing the modal did not restore its trigger focus')
    }
    await viewer.getByRole('button', { name: 'View latest handoff' }).click()
    await viewer.getByRole('dialog').waitFor()
    await viewer.setViewportSize({ width: 390, height: 450 })
    await checkDialogViewport('short mobile')
    const scroll = await viewer.getByRole('dialog').evaluate((dialog) => {
      dialog.scrollTop = dialog.scrollHeight
      const guidance = dialog.lastElementChild.getBoundingClientRect()
      return { top: dialog.scrollTop, bottom: guidance.bottom, viewportHeight: innerHeight }
    })
    if (scroll.top <= 0 || scroll.bottom > scroll.viewportHeight + 1) throw new Error('Short dialog content is not reachable by scrolling')
    await viewer.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await viewer.getByRole('dialog').waitFor({ state: 'hidden' })
  } finally {
    await historyContext.close()
  }
  await page.getByRole('button', { name: 'Not sent' }).click()

  await page.getByRole('link', { name: 'Prospects' }).click()
  await page.getByRole('button', { name: 'Stop contact', exact: true }).click()
  const stopDialog = page.getByRole('dialog', { name: 'Stop contact: Alex Example' })
  const privateStopReason = 'Fictional private reason: do not contact again'
  await stopDialog.getByLabel('Reason').fill(privateStopReason)
  await stopDialog.getByRole('button', { name: 'Confirm stop contact' }).click()
  await stopDialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Stop contact' && button.disabled))

  // Verify stored output of the rendered actions, not merely success notices.
  const auditExportResponse = await page.request.get(`${origin}/api/export`)
  assert.ok(auditExportResponse.ok(), 'Audit privacy export failed')
  const auditExport = await auditExportResponse.json()
  const detailFor = (type) => {
    const event = auditExport.audit_events.find((item) => item.event_type === type)
    assert.ok(event, `Missing real browser action audit ${type}`)
    return JSON.parse(event.details)
  }
  assert.deepEqual(detailFor('prospect.suppressed'), { restriction: 'do_not_contact' })
  assert.deepEqual(detailFor('provider.updated'), { mode: 'assisted' })
  assert.deepEqual(detailFor('draft.approved'), { checks: ['manual_send_understood', 'message_personalized', 'policy_reviewed', 'source_authorized'] })
  assert.equal(auditExport.suppressions[0].reason, privateStopReason)
  assert.ok(!JSON.stringify(auditExport.audit_events).includes(privateStopReason))
  assert.ok(!JSON.stringify(auditExport.audit_events).includes(privateProviderURL))
  const settingsResponse = await page.request.get(`${origin}/api/settings`)
  assert.ok(settingsResponse.ok(), 'Audit privacy settings read failed')
  assert.equal((await settingsResponse.json()).providers[0].base_url, privateProviderURL)

  // Exercise the remaining local operator journey with a separate fictional record.
  // "Sent manually" below is simulated fixture state, not a real send claim.
  await page.getByRole('button', { name: 'Add prospect', exact: true }).click()
  const replyProspect = page.getByRole('dialog', { name: 'Add prospect' })
  await replyProspect.getByRole('textbox', { name: 'Name', exact: true }).fill('Jordan QA Fixture')
  await replyProspect.getByRole('textbox', { name: 'Organization' }).fill('Isolated QA')
  await replyProspect.getByRole('textbox', { name: /Source URL/ }).fill('https://simbi.com/isolated-qa-fixture')
  await replyProspect.getByRole('combobox', { name: 'Consent context' }).selectOption('contextual')
  await replyProspect.getByRole('textbox', { name: 'Notes' }).fill('Fictional browser-test record; no provider contact.')
  await replyProspect.getByRole('button', { name: 'Add prospect' }).click()
  await replyProspect.waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: 'Review queue' }).click()
  await page.getByRole('button', { name: 'Prepare draft', exact: true }).click()
  const replyDraft = page.getByRole('dialog', { name: 'Prepare a deterministic draft' })
  await replyDraft.getByRole('combobox', { name: 'Campaign' }).selectOption({ label: 'Production readiness outreach (active)' })
  await replyDraft.getByRole('combobox', { name: 'Prospect' }).selectOption({ label: 'Jordan QA Fixture — Isolated QA' })
  await replyDraft.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Production introduction' })
  await replyDraft.getByRole('button', { name: 'Prepare draft' }).click()
  await replyDraft.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /Jordan QA Fixture.*needs review/i }).click()
  await page.getByRole('button', { name: 'Approve for handoff' }).waitFor()
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
  await page.getByRole('button', { name: 'Approve for handoff' }).click()
  await page.getByRole('button', { name: 'Copy and open provider' }).click()
  const simulatedOutcome = page.waitForResponse((response) => response.url().endsWith('/outcome') && response.request().method() === 'POST')
  await page.getByRole('dialog', { name: 'Manual provider handoff' }).getByRole('button', { name: 'Sent manually', exact: true }).click()
  const outcomeResult = await simulatedOutcome
  if (!outcomeResult.ok() || (await outcomeResult.json()).draft_state !== 'sent') throw new Error('Simulated local sent outcome did not persist')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })

  await page.getByRole('link', { name: 'Reminders', exact: true }).click()
  const reminderIds = []
  for (const title of ['QA decision completed manually', 'QA follow-up closed by reply']) {
    await page.getByRole('button', { name: 'New reminder' }).click()
    const reminder = page.getByRole('dialog', { name: 'Create reminder' })
    await reminder.getByRole('combobox', { name: 'Conversation' }).selectOption({ label: 'Jordan QA Fixture — Production readiness outreach' })
    await reminder.getByRole('textbox', { name: 'Reminder', exact: true }).fill(title)
    await reminder.getByLabel('Due', { exact: true }).fill('2030-01-15T10:30')
    const created = page.waitForResponse((response) => response.url().endsWith('/api/reminders') && response.request().method() === 'POST')
    await reminder.getByRole('button', { name: 'Create reminder' }).click()
    const result = await created
    if (!result.ok()) throw new Error(`Reminder creation failed: ${result.status()}`)
    reminderIds.push((await result.json()).id)
    await reminder.waitFor({ state: 'hidden' })
    await page.getByText(title, { exact: true }).waitFor()
  }
  const completedTask = page.locator('.task-list article').filter({ hasText: 'QA decision completed manually' })
  await completedTask.getByRole('button', { name: 'Done', exact: true }).click()
  await completedTask.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('QA follow-up closed by reply', { exact: true }).waitFor()
  if (await page.getByText('QA decision completed manually', { exact: true }).count()) throw new Error('Completed reminder returned after reload')

  await page.getByRole('link', { name: 'Replies', exact: true }).click()
  await page.getByRole('button', { name: 'Record reply', exact: true }).click()
  const reply = page.getByRole('dialog', { name: 'Record provider reply' })
  await reply.getByRole('combobox', { name: 'Conversation' }).selectOption({ label: 'Jordan QA Fixture — Production readiness outreach (sent)' })
  const replyText = 'Fictional QA reply: this tests local record keeping, not provider delivery.'
  await reply.getByRole('textbox', { name: 'Reply or concise summary' }).fill(replyText)
  await reply.getByRole('button', { name: 'Record reply', exact: true }).click()
  await reply.waitFor({ state: 'hidden' })
  await page.getByText(replyText, { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText(replyText, { exact: true }).waitFor()
  await page.screenshot({ path: join(screenshots, 'simbi-qa-reply.png'), fullPage: false })

  await page.getByRole('link', { name: 'Reminders', exact: true }).click()
  await page.getByRole('heading', { name: 'No open reminders' }).waitFor()
  for (const [status, id] of [['done', reminderIds[0]], ['cancelled', reminderIds[1]]]) {
    const response = await page.request.get(`${origin}/api/reminders?status=${status}`)
    if (!response.ok() || !(await response.json()).items.some((item) => item.id === id)) {
      throw new Error(`Expected reminder ${id} to persist as ${status}`)
    }
  }

  await page.getByRole('link', { name: 'Reports', exact: true }).click()
  const campaignReport = page.getByRole('row').filter({ hasText: 'Production readiness outreach' })
  await campaignReport.waitFor()
  const reportCells = await campaignReport.getByRole('cell').allTextContents()
  // Counts represent current states: a replied draft is no longer in the sent bucket.
  if (reportCells[2] !== '2' || reportCells[3] !== '0' || reportCells[4] !== '1') {
    throw new Error(`Unexpected campaign draft/sent/reply counts: ${JSON.stringify(reportCells)}`)
  }
  for (const [label, expected] of [['total', '2'], ['sent', '0'], ['replied', '1'], ['suppressed', '1']]) {
    const metric = page.locator('.metric-rail > div').filter({ has: page.getByText(label, { exact: true }) })
    if (await metric.locator('strong').innerText() !== expected) throw new Error(`Incorrect ${label} report metric`)
  }
  await page.screenshot({ path: join(screenshots, 'simbi-qa-report.png'), fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0)
  const mobileReport = await page.locator('.table-wrap').evaluate((table) => {
    table.scrollLeft = table.scrollWidth
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      tableRight: table.getBoundingClientRect().right,
      lastCellRight: table.querySelector('tbody tr td:last-child').getBoundingClientRect().right,
    }
  })
  if (mobileReport.pageWidth > mobileReport.viewportWidth + 1 || mobileReport.lastCellRight > mobileReport.tableRight + 1) {
    throw new Error(`Mobile report overflows the page or cannot reveal its final column: ${JSON.stringify(mobileReport)}`)
  }
  await page.locator('.table-wrap').evaluate((table) => { table.scrollLeft = 0 })
  await page.screenshot({ path: join(screenshots, 'simbi-qa-report-mobile.png'), fullPage: false })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0)

  // Hold real local reads before letting the backend respond. Pending is not empty.
  for (const [nav, endpoint, label, emptyTitle] of [
    ['Overview', '/overview', 'overview', 'Your queue is clear'],
    ['Prospects', '/prospects', 'prospects', 'No prospects'],
    ['Campaigns', '/campaigns', 'campaigns', 'No campaigns'],
    ['Templates', '/templates', 'templates', 'No templates'],
    ['Review queue', '/drafts', 'drafts', 'No drafts to review'],
    ['Replies', '/replies', 'replies', 'No replies recorded'],
    ['Reminders', '/reminders', 'reminders', 'No open reminders'],
    ['Audit log', '/audit', 'audit events', 'No events yet'],
    ['Reports', '/reports/summary', 'reports', 'No report data'],
  ]) {
    const matcher = `${origin}/api${endpoint}*`
    let releaseRead
    const heldRead = new Promise((resolveRead) => { releaseRead = resolveRead })
    await page.route(matcher, async (route) => { await heldRead; await route.continue() })
    try {
      await page.getByRole('link', { name: nav, exact: true }).click()
      await page.getByText(`Loading ${label}…`, { exact: true }).waitFor()
      if (await page.getByRole('heading', { name: emptyTitle, exact: true }).count()) {
        throw new Error(`${nav} declared an empty result while its read was pending`)
      }
      if (nav === 'Reports' && await page.locator('.metric-rail').count()) throw new Error('Pending report invented metrics')
      if (nav === 'Campaigns') {
        await page.screenshot({ path: join(screenshots, 'simbi-loading-desktop.png'), fullPage: false })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0)
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile loading state overflows')
        await page.screenshot({ path: join(screenshots, 'simbi-loading-mobile.png'), fullPage: false })
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      releaseRead()
      await page.getByText(`Loading ${label}…`, { exact: true }).waitFor({ state: 'hidden' })
      if (nav === 'Campaigns') await page.locator('.resource-row h3').filter({ hasText: 'Production readiness outreach' }).waitFor()
    } finally { releaseRead(); await page.unroute(matcher) }
  }

  expectedDataFailurePath = '/campaigns'
  await page.route(`${origin}/api/campaigns*`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'qa_temporary', message: 'QA campaign read failure' } }) }))
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click()
  await page.getByText('No result is available for campaigns.').waitFor()
  if (await page.getByRole('heading', { name: 'No campaigns', exact: true }).count()) throw new Error('Failed campaign read declared no campaigns')
  await page.screenshot({ path: join(screenshots, 'simbi-loading-error.png'), fullPage: false })
  await page.unroute(`${origin}/api/campaigns*`)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.locator('.resource-row h3').filter({ hasText: 'Production readiness outreach' }).waitFor()

  await page.getByRole('link', { name: 'Reports', exact: true }).click()
  await page.getByRole('row').filter({ hasText: 'Production readiness outreach' }).waitFor()
  expectedDataFailurePath = '/reports/summary'
  await page.route(`${origin}/api/reports/summary`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'qa_temporary', message: 'QA report refresh failure' } }) }))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Showing the last loaded result; it may be out of date.').waitFor()
  if (await page.locator('.metric-rail > div').filter({ has: page.getByText('total', { exact: true }) }).locator('strong').innerText() !== '2') throw new Error('Failed report refresh lost last loaded values')
  await page.unroute(`${origin}/api/reports/summary`)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByText('Showing the last loaded result; it may be out of date.').waitFor({ state: 'hidden' })
  expectedDataFailurePath = ''
  if (dataFailureProbes !== 2) throw new Error(`Expected exactly two controlled data failures, observed ${dataFailureProbes}`)

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Current password', { exact: true }).fill('correct horse battery staple')
  await page.getByLabel('New password', { exact: true }).fill('a different long QA password')
  await page.getByRole('button', { name: /Change password/ }).click()
  signedOutProbeExpected = true
  await page.getByRole('link', { name: 'Sign in again' }).click()
  await page.getByRole('textbox', { name: 'Email' }).fill('qa@example.test')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('a different long QA password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: /Good morning/ }).waitFor()
  signedOutProbeExpected = false
  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByRole('heading', { name: /Good morning/ }).waitFor()

  await bilingualWorkflow(page, origin, runtime)
  await page.addScriptTag({ content: axe.source })
  const dutchAccessibility = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  if (dutchAccessibility.violations.length) throw new Error(`Dutch accessibility violations: ${JSON.stringify(dutchAccessibility.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })))}`)
  await page.getByRole('combobox', { name: 'Language / Taal' }).selectOption('en')
  await privacyWorkflow(page, origin, root, 'a different long QA password', axe, screenshots)
  await auditPrivacyWorkflow(page, origin, root, runtime, python, 'a different long QA password', axe, screenshots)
  await retentionPagesWorkflow(page, origin, root, runtime, python, 'a different long QA password', axe, screenshots, (expected) => { cleanupAbortExpected = expected })
  assert.equal(cleanupAborts, 1, 'Expected exactly one actual post-commit cleanup response abort')
  await draftSaveWorkflow(page, origin, axe, screenshots)
  await keyboardOutreachWorkflow(page, origin, axe, screenshots)
  await reminderReplayWorkflow(page, origin, axe, screenshots, (expected) => { reminderFailureExpected = expected })
  assert.equal(reminderAborts, 2, 'Exactly one real reminder response abort per locale')
  assert.equal(reminderConflicts, 2, 'Exactly one actual changed-payload refusal per locale')
  await creationReplayWorkflow(page, origin, axe, screenshots, (path, expected) => { creationFailurePath = path; creationFailureExpected = expected })
  assert.equal(creationAborts, 12, 'Exactly one real response abort per core creation/locale')
  assert.equal(creationConflicts, 12, 'Exactly one real changed-payload refusal per core creation/locale')
  await pageRecordsWorkflow(page, origin, axe, screenshots)
  await operationalReadsWorkflow(page, origin, axe, screenshots)
  await safetyMutationsWorkflow(page, origin, axe, screenshots)
  await providerInputRecoveryWorkflow(page, origin, axe, screenshots)
  await conversationRecordsWorkflow(page, origin, root, runtime, python, axe, screenshots)
  await navigationWorkflow(page, origin, axe, screenshots)
  await page.addScriptTag({ content: axe.source })
  const accessibility = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }))
  if (accessibility.violations.length) {
    const summary = accessibility.violations.map((item) => {
      const nodes = item.nodes.map((node) =>
        `  ${node.target.join(' ')}: ${node.failureSummary ?? node.html}`
      ).join('\n')
      return `${item.id}: ${item.help}\n${nodes}`
    }).join('\n')
    throw new Error(`Accessibility violations:\n${summary}`)
  }
  await page.screenshot({ path: join(runtime, 'desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Primary navigation' }).waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(runtime, 'mobile.png'), fullPage: true })

  if (browserErrors.length) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`)
  if (sessionFailureProbes !== 1 || signedOutProbes !== 1) throw new Error(`Unexpected session probe counts: ${sessionFailureProbes}/${signedOutProbes}`)
  process.stdout.write(`${JSON.stringify({
    browser_engine: engine.name,
    browser_version: browser.version(),
    screenshot_directory: screenshots,
    critical_path: 'passed',
    personal_cleanup_preview_cancel_backup_confirmation_and_receipt_recovery: 'passed in English and Dutch',
    campaign_and_template_cleanup_counts_cancel_backup_preservation_and_receipts: 'passed in English and Dutch',
    dutch_workflow_and_language_persistence: 'passed',
    other_tab_language_switch_preserves_unsaved_modal: 'passed',
    language_switch_preserves_review_checks_and_authored_content: 'passed',
    dutch_accessibility_violations: 0,
    interrupted_handoff_recovery: 'passed',
    exact_content_approval: 'passed',
    version_bound_draft_saves_and_uncertain_response_recovery: 'passed in English/Dutch with real sibling tabs, two stale-save refusals per locale, nonmutating compare/cancel/rebase and explicit saved-version recovery; Dutch post-commit response really aborted; no duplicate save or message storage',
    explicit_save_draft_leave_protection: 'passed in English/Dutch: same-row preservation, other-row/preparation/sign-out cancellation, desktop/mobile route and real Back protection, Escape/tab containment/editor focus, explicit discard, pending response refusal/no auto-navigation; four added selected scans, nine stored arrays unchanged and zero guard-related writes; native reload cancellation driven only on Chromium; no autosave/crash guarantee',
    operator_stop_contact: 'passed',
    new_audit_metadata_minimization: 'passed; original restriction reason and provider setting preserved',
    historical_audit_exact_fields_backup_cancel_unverified_response_and_idempotent_retry: 'passed in English and Dutch; operational restrictions, settings and core event evidence preserved',
    retention_scan_pages_batches_backup_preservation_and_verified_retry: 'passed in English and Dutch beyond 1000 contacts; 50+3 exact batches; English wrong-count receipt and Dutch actual post-commit response abort recovered without duplicate removal; exact older-receipt lookup after reload preserved operational/audit records',
    local_simulated_outcome_reply_reminder_report: 'passed',
    personal_keyboard_outreach: 'passed; English desktop/Dutch mobile sequential Tab and native keyboard input through campaign, prospect, template, draft, explicit save/review, fictional uncertainty, reminder, reply, report and stop-contact; three real committed-but-mismatched creation recoveries per locale, no provider/pointer actions, twelve UI mutations per locale, prior records preserved, twelve selected accessibility scans',
    provider_delivery: 'not attempted; sent/reply records are fictional QA fixtures',
    reminder_creation_replay: 'passed; real committed-response abort plus changed-payload refusal and explicit same-key recovery in English desktop/Dutch mobile; one reminder/audit per locale, no replay mutation, all prior nine-table records preserved, four selected scans; no provider or durable browser-copy claim',
    core_creation_replay: 'passed; six creation paths in English desktop/Dutch mobile, twelve real commit/response aborts plus twelve changed-values refusals, original same-key recovery without replay mutation, 24 selected accessibility scans; separate local manual handoff uncertainty enables reply fixture, no provider activity or durable browser-copy claim',
    legacy_conversation_chronology: 'passed; 52 valid plus three unsupported fictional dates per table/locale, offset/day-boundary/microsecond ordering, keyboard next/previous/final pages, English desktop/Dutch mobile unrecognized-date labels with exact raw API values, unchanged old rows and nine exported tables, zero HTTP writes and eight selected accessibility scans',
    core_page_record_validation: 'passed; all seven core resources in English desktop/Dutch mobile, damaged actual successful reads rejected before rendering, native keyboard explicit retry recovers actual records, 28 selected scans, zero automatic read retries or HTTP writes, nine exported tables unchanged; no generic schema or owner/provider acceptance claim',
    operational_read_validation: 'passed; actual dashboard/report/settings/bootstrap/session GETs damaged then recovered through native explicit Retry/Try again in English desktop/Dutch mobile, all four safety statuses visible including 1100px checks, 22 selected scans, zero automatic retries or HTTP writes, nine exported tables unchanged; no backup/privacy certification or provider/owner acceptance claim',
    safety_mutation_confirmation_validation: 'passed; six actual committed compliance/provider/pause confirmations damaged then refused, explicit read-only recovery, six correct confirmations, 18 selected scans; 12 deliberate fictional writes/audit events, eight record arrays and prior audit events unchanged; no provider/account acceptance',
    provider_input_recovery: 'passed; English desktop/Dutch mobile original provider fields retained through changed snapshot, committed-but-contradictory follow-up and failed/successful read-only recovery; explicit verified save normalizes without remount, 12 selected scans, four deliberate local writes/audit events, eight record arrays and prior audit events unchanged; RAM-only, no provider access or delivery proof',
    password_change_reauthentication: 'passed',
    viewer_download_permissions: 'passed',
    viewer_read_only_routes_and_handoff_history: 'passed',
    modal_viewport_focus_escape_and_scroll: 'passed',
    session_failure_retry_preserves_login: 'passed',
    delayed_reads_on_nine_operational_routes: 'passed',
    campaign_read_failure_retry_and_stale_report_refresh: 'passed',
    expected_data_failure_probes: dataFailureProbes,
    expected_session_failure_probes: sessionFailureProbes,
    expected_signed_out_probes: signedOutProbes,
    provider_navigation: 'not attempted',
    accessibility_violations: 0,
    responsive_mobile_menu: 'passed',
    owner_keyboard_navigation_all_eleven_routes_both_locales_and_viewports: 'passed; skip, native drawer, tab containment, Escape, destination focus, Help, short-screen scroll and resize; zero record writes; 48 automated accessibility scans',
    viewer_keyboard_navigation_all_eleven_routes_both_locales_and_viewports: 'passed; same 48 scans without enabling restricted write controls',
    browser_errors: 0,
    fixture_runtime: runtime,
  }, null, 2)}\n`)
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    if (pages[0]) await pages[0].screenshot({ path: join(runtime, 'failure.png'), fullPage: true }).catch(() => {})
  }
  throw error
} finally {
  if (browser) await browser.close()
  if (server.exitCode === null) server.kill('SIGTERM')
}
