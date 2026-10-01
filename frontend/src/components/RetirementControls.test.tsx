import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import RetirementControls from './RetirementControls'

const plan = { kind: 'retirement', plan_id: 'a'.repeat(32), expires_at: '2030-01-01T00:00:00Z', counts: { users: 1, workspaces: 1, prospects: 2 }, owner_name: 'Fictional Owner', workspace_name: 'Fictional Workspace' }
const receipt = { ...plan, backup_file: 'fixture-recovery.db', completed_at: '2026-10-01T10:00:00Z', replayed: false }
const response = (data: unknown, status = 200) => Response.json(data, { status })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview personal retirement' }))
  await screen.findByRole('heading', { name: 'Personal retirement preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Review personal retirement' }))
  return screen.getByRole('dialog')
}
function authorize(dialog: HTMLElement) {
  within(dialog).getAllByRole('checkbox').forEach((box) => fireEvent.click(box))
  fireEvent.change(within(dialog).getByLabelText('Type RETIRE to confirm'), { target: { value: 'RETIRE' } })
  fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
  return within(dialog).getByRole('button', { name: 'Retire this installation' }).closest('form')!
}

describe('personal retirement controls', () => {
  it('rejects a malformed or mismatched successful-response receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/preview') ? plan : { ...receipt, plan_id: 'b'.repeat(32) })))
    const onRetired = vi.fn()
    render(<RetirementControls paused onRetired={onRetired} />)
    fireEvent.submit(authorize(await open()))
    await screen.findByText('The response was interrupted. Retirement is not confirmed; check the completion receipt before retrying.')
    expect(onRetired).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retire this installation' })).toBeDisabled()
  })
  it('requires the safety stop before previewing', () => {
    render(<RetirementControls paused={false} onRetired={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Preview personal retirement' })).toBeDisabled()
  })
  it('cancel is non-destructive and forgets credentials and acknowledgements', async () => {
    const fetchMock = vi.fn(async () => response(plan))
    vi.stubGlobal('fetch', fetchMock)
    render(<RetirementControls paused onRetired={vi.fn()} />)
    const dialog = await open()
    expect(within(dialog).getByRole('button', { name: 'Retire this installation' })).toBeDisabled()
    authorize(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Review personal retirement' }))
    expect(screen.getByLabelText('Local account password')).toHaveValue('')
    expect(screen.getByLabelText('Type RETIRE to confirm')).toHaveValue('')
    screen.getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked())
  })
  it('guards duplicate submission and closes only after receipt', async () => {
    let release: (result: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/confirm') ? pending : response(plan))
    const onRetired = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<RetirementControls paused onRetired={onRetired} />)
    const dialog = await open()
    const form = authorize(dialog)
    fireEvent.submit(form); fireEvent.submit(form)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    release(response(receipt))
    await waitFor(() => expect(onRetired).toHaveBeenCalledWith(receipt))
  })
  it('recovers a successful commit after a lost response using a read-only receipt', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      if (url.endsWith('/confirm')) throw new TypeError('fixture response interrupted')
      return response(url.includes('/receipt/') ? receipt : plan)
    }))
    const onRetired = vi.fn()
    render(<RetirementControls paused onRetired={onRetired} />)
    fireEvent.submit(authorize(await open()))
    await waitFor(() => expect(onRetired).toHaveBeenCalledWith(receipt))
    expect(requests).toEqual(['/api/privacy/retirement/preview', '/api/privacy/retirement/confirm', `/api/privacy/retirement/receipt/${plan.plan_id}`])
  })
  it('never claims success without a completion receipt after interruption', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/confirm')) throw new TypeError('fixture transport loss')
      return url.includes('/receipt/') ? response({ error: { code: 'not_found', message: 'The requested receipt was not found' } }, 404) : response(plan)
    }))
    const onRetired = vi.fn()
    render(<RetirementControls paused onRetired={onRetired} />)
    fireEvent.submit(authorize(await open()))
    await screen.findByText('The response was interrupted. Retirement is not confirmed; check the completion receipt before retrying.')
    expect(onRetired).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retire this installation' })).toBeDisabled()
    expect(screen.getByLabelText('Local account password')).toHaveValue('')
  })
  it.each(['current_password_invalid', 'privacy_preview_changed'])('requires a fresh preview after %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/confirm') ? response({ error: { code, message: 'Records changed after the preview; create a new preview' } }, 409) : response(plan)))
    render(<RetirementControls paused onRetired={vi.fn()} />)
    fireEvent.submit(authorize(await open()))
    await screen.findByText('Records changed after the preview; create a new preview')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Personal retirement preview' })).not.toBeInTheDocument()
  })
  it('localizes Dutch controls without translating user names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(plan)))
    render(<I18nProvider initialLocale="nl"><RetirementControls paused onRetired={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Beëindiging vooraf bekijken' }))
    expect(await screen.findByText('Lokale eigenaar: Fictional Owner. Werkruimte: Fictional Workspace.')).toBeVisible()
    expect(screen.getByText('Lokale accounts')).toBeVisible()
  })
})
