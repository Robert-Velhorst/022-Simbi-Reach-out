import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const axe = require('axe-core')
const { chromium } = require('playwright')
const runtimeRoot = resolve(root, '.e2e-runtime')
if (dirname(runtimeRoot) !== root || !runtimeRoot.endsWith('.e2e-runtime')) {
  throw new Error(`Unsafe E2E runtime path: ${runtimeRoot}`)
}
await mkdir(runtimeRoot, { recursive: true })
const runtime = await mkdtemp(join(runtimeRoot, 'run-'))

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
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    bypassCSP: true,
  })
  const browserErrors = []
  // These are fictional local workflow records, never evidence of provider delivery.
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    browserErrors.push(`Unexpected external request: ${new URL(route.request().url()).origin}`)
    return route.abort('blockedbyclient')
  })
  let signedOutProbeExpected = false
  let signedOutProbes = 0
  let sessionFailureExpected = false
  let sessionFailureProbes = 0
  let expectedDataFailurePath = ''
  let dataFailureProbes = 0
  page.on('console', (message) => {
    if (expectedDataFailurePath && message.location().url.startsWith(`${origin}/api${expectedDataFailurePath}`)
      && message.text().includes('503')) { dataFailureProbes++; return }
    if (sessionFailureExpected && message.location().url === `${origin}/api/me`
      && message.text().includes('503')) { sessionFailureProbes++; return }
    if (signedOutProbeExpected && message.location().url === `${origin}/api/me`
      && message.text().includes('401')) { signedOutProbes++; return }
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`))

  await page.goto(origin, { waitUntil: 'networkidle' })
  if (!(await page.title()).includes('Simbi') || !page.url().startsWith(origin)) {
    throw new Error('Unexpected application identity')
  }
  await page.getByRole('textbox', { name: 'Your name' }).fill('Production QA')
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Production QA workspace')
  await page.getByRole('textbox', { name: 'Email' }).fill('qa@example.test')
  await page.getByRole('textbox', { name: /Password/ }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create workspace' }).click()
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
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
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
    for (const path of ['/api/export', '/api/support-bundle']) {
      const denied = await viewer.request.get(`${origin}${path}`)
      if (denied.status() !== 403 || (await denied.json()).error?.code !== 'permission_denied') {
        throw new Error(`Viewer download authorization failed for ${path}`)
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
  await page.getByRole('button', { name: 'Save and return to review' }).click()
  await page.getByRole('button', { name: 'Save and return to review' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Save and return to review' && !button.disabled))
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
    await viewer.screenshot({ path: resolve(root, '..', 'simbi-viewer-handoff.png'), fullPage: false })
    await viewer.setViewportSize({ width: 390, height: 844 })
    await checkDialogViewport('mobile')
    await viewer.screenshot({ path: resolve(root, '..', 'simbi-viewer-handoff-mobile.png'), fullPage: false })
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
  await stopDialog.getByLabel('Reason').fill('QA record: do not contact again')
  await stopDialog.getByRole('button', { name: 'Confirm stop contact' }).click()
  await stopDialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Stop contact' && button.disabled))

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
  await page.screenshot({ path: resolve(root, '..', 'simbi-qa-reply.png'), fullPage: false })

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
  await page.screenshot({ path: resolve(root, '..', 'simbi-qa-report.png'), fullPage: false })
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
  await page.screenshot({ path: resolve(root, '..', 'simbi-qa-report-mobile.png'), fullPage: false })
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
        await page.screenshot({ path: resolve(root, '..', 'simbi-loading-desktop.png'), fullPage: false })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0)
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile loading state overflows')
        await page.screenshot({ path: resolve(root, '..', 'simbi-loading-mobile.png'), fullPage: false })
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
  await page.screenshot({ path: resolve(root, '..', 'simbi-loading-error.png'), fullPage: false })
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
  process.stdout.write(`${JSON.stringify({
    critical_path: 'passed',
    interrupted_handoff_recovery: 'passed',
    exact_content_approval: 'passed',
    operator_stop_contact: 'passed',
    local_simulated_outcome_reply_reminder_report: 'passed',
    provider_delivery: 'not attempted; sent/reply records are fictional QA fixtures',
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
