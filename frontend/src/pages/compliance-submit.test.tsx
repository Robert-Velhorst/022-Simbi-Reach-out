import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './Settings'
import type { Member } from '../types'
import { I18nProvider, translate } from '../i18n'

const member: Member = { user_id: 1, email: 'fictional@example.test', display_name: 'Fictional Owner', workspace_id: 1, workspace_name: 'Fictional workspace', role: 'owner', mode: 'assisted', compliance_ack_at: null, paused_at: null, environment: 'test', demo_mode: false }
const names = ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process']
const payload = Object.fromEntries(names.map((name) => [name, true]))
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const settings = { workspace: { name: 'Fictional workspace', compliance_ack_at: null, paused_at: null, retention_days: 365 }, providers: [], members: [], environment: 'test', demo_mode: false }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function service() {
  let acknowledged: string | null = null
  let complete: (response: Response) => void = () => {}
  let pending = new Promise<Response>((done) => { complete = done })
  const writes: unknown[] = []
  const fetcher = vi.fn((url: string, options: RequestInit) => {
    if (url === '/api/settings/compliance' && options.method === 'POST') { writes.push(JSON.parse(String(options.body))); return pending }
    return Promise.resolve(response(url === '/api/me' ? { ...member, compliance_ack_at: acknowledged } : { ...settings, workspace: { ...settings.workspace, compliance_ack_at: acknowledged } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { writes, complete: async (value: Response) => {
    const result = await value.clone().json()
    if (value.ok && typeof result.compliance_ack_at === 'string') acknowledged = result.compliance_ack_at
    complete(value)
  }, next: () => { pending = new Promise<Response>((done) => { complete = done }) } }
}

async function form() {
  const button = await screen.findByRole('button', { name: 'Record acknowledgement' })
  await waitFor(() => expect(screen.getByText('Retention window: 365 days. Suppression records are retained so opt-outs are not forgotten.')).toBeInTheDocument())
  const form = button.closest('form')!
  const boxes = names.map((name) => form.querySelector<HTMLInputElement>(`[name=${name}]`)!)
  boxes.forEach((box) => fireEvent.click(box))
  return { button, form, boxes }
}

describe('compliance confirmation submission', () => {
  it('restores the submitting control only if disabling it left focus on the page body', async () => {
    const fixture = service()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    const controls = await form()
    controls.button.focus()
    fireEvent.submit(controls.form)
    const blurSource = screen.getByRole('button', { name: 'Change password' })
    blurSource.focus(); blurSource.blur() // jsdom cannot naturally blur a disabled control.
    expect(document.body).toHaveFocus()
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await screen.findByText('Compliance acknowledgement recorded in the audit log.')
    await waitFor(() => expect(controls.button).toHaveFocus())
  })

  it('does not steal focus if the operator moved to another control while waiting', async () => {
    const fixture = service()
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    const controls = await form()
    controls.button.focus()
    fireEvent.submit(controls.form)
    const other = screen.getByRole('button', { name: 'Change password' })
    other.focus()
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await screen.findByText('Compliance acknowledgement recorded in the audit log.')
    expect(other).toHaveFocus()
  })

  it('blocks repeat submissions synchronously and disables confirmation while pending', async () => {
    const fixture = service()
    const onMemberChange = vi.fn()
    render(<SettingsPage member={member} onMemberChange={onMemberChange} />)
    const controls = await form()
    fireEvent.submit(controls.form)
    const disabled = (controls.button as HTMLButtonElement).disabled
    fireEvent.submit(controls.form)
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await screen.findByText('Compliance acknowledgement recorded in the audit log.')
    expect(fixture.writes).toEqual([payload])
    expect(disabled).toBe(true)
    expect(onMemberChange).toHaveBeenCalledTimes(1)
    expect(controls.button).toBeEnabled()
  })

  it('preserves the four choices on rejection and allows one explicit retry', async () => {
    const fixture = service()
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    const controls = await form()
    fireEvent.submit(controls.form)
    fixture.complete(response({ error: { code: 'fixture_rejected', message: 'Fictional confirmation rejected' } }, 503))
    await screen.findByText(/may already have changed local records.*before retrying/)
    expect(controls.boxes.every((box) => box.checked)).toBe(true)
    expect(controls.button).toBeDisabled()
    expect(screen.queryByText('Compliance acknowledgement recorded in the audit log.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(controls.button).toBeEnabled())
    expect(fixture.writes).toEqual([payload])
    fixture.next()
    fireEvent.submit(controls.form)
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await screen.findByText('Compliance acknowledgement recorded in the audit log.')
    expect(fixture.writes).toEqual([payload, payload])
  })

  it('does not submit for a viewer even when the form event is dispatched directly', async () => {
    const fixture = service()
    render(<SettingsPage member={{ ...member, role: 'viewer' }} onMemberChange={() => {}} />)
    const controls = await form()
    fireEvent.submit(controls.form)
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await new Promise((done) => setTimeout(done, 0))
    expect(fixture.writes).toEqual([])
    expect(controls.button).toBeDisabled()
  })

  it.each(['en', 'nl'] as const)('shows a localized pending state and freezes the four choices in %s', async (locale) => {
    const fixture = service()
    render(<I18nProvider initialLocale={locale}><SettingsPage member={member} onMemberChange={() => {}} /></I18nProvider>)
    const button = await screen.findByRole('button', { name: translate(locale, 'Record acknowledgement') })
    const form = button.closest('form')!
    const boxes = names.map((name) => form.querySelector<HTMLInputElement>(`[name=${name}]`)!)
    boxes.forEach((box) => fireEvent.click(box))
    fireEvent.submit(form)
    expect(screen.getByRole('button', { name: translate(locale, 'Recording acknowledgement…') })).toBeDisabled()
    expect(boxes.every((box) => box.disabled && box.checked)).toBe(true)
    fixture.complete(response({ compliance_ack_at: '2026-10-01T12:00:00Z' }))
    await screen.findByText(translate(locale, 'Compliance acknowledgement recorded in the audit log.'))
    expect(button).toBeEnabled()
    expect(boxes.every((box) => !box.disabled && box.checked)).toBe(true)
    expect(fixture.writes).toEqual([payload])
  })
})
