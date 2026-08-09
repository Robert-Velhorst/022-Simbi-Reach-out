import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend', 'package.json'))
const axe = require('axe-core')
const { chromium } = require('playwright')
const runtime = resolve(root, '.e2e-runtime')
if (dirname(runtime) !== root || !runtime.endsWith('.e2e-runtime')) {
  throw new Error(`Unsafe E2E runtime path: ${runtime}`)
}
await rm(runtime, { recursive: true, force: true })
await mkdir(runtime, { recursive: true })

const python = process.env.SIMBI_E2E_PYTHON
  ?? (process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : 'python')
const origin = 'http://127.0.0.1:4173'
const serverOutput = []
const server = spawn(python, [
  '-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '4173',
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
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`))

  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Your name' }).fill('Production QA')
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Production QA workspace')
  await page.getByRole('textbox', { name: 'Email' }).fill('qa@example.test')
  await page.getByRole('textbox', { name: /Password/ }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByRole('heading', { name: /Good morning/ }).waitFor()

  await page.getByRole('link', { name: 'Settings' }).click()
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
  await page.getByRole('button', { name: 'Approve for handoff' }).click()
  await page.getByRole('button', { name: 'Copy and open provider' }).click()
  const providerLink = page.getByRole('link', { name: /Open provider/ })
  if (await providerLink.getAttribute('href') !== 'https://simbi.com/alex-example') {
    throw new Error('The assisted handoff did not preserve the approved provider URL')
  }
  await page.getByRole('button', { name: 'Not sent' }).click()
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
    provider_navigation: 'not attempted',
    accessibility_violations: 0,
    responsive_mobile_menu: 'passed',
    browser_errors: 0,
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
