import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './pages/Settings'
import { fictionalMember, operationalReads } from './test/operational-reads'
import type { Member } from './types'
import { randomUUID } from 'node:crypto'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const oldPassword = randomUUID()
const newPassword = randomUUID()

async function showPasswordForm() {
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  const current = await screen.findByLabelText('Current password')
  const next = screen.getByLabelText('New password')
  fireEvent.change(current, { target: { value: oldPassword } })
  fireEvent.change(next, { target: { value: newPassword } })
  return { current, next, form: current.closest('form')! }
}

describe('actual personal password-change caller', () => {
  it.each([{}, { changed: false, reauthenticate: true }, { changed: true, reauthenticate: false }, { changed: 'true', reauthenticate: true }])('does not claim a password change after an unverified confirmation: %j', async (receipt) => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/auth/password' && options.method === 'POST') {
        writes.push(JSON.parse(String(options.body)))
        return Response.json(receipt)
      }
      return Response.json(operationalReads['/settings'])
    }))
    const fields = await showPasswordForm()
    fireEvent.submit(fields.form)
    await waitFor(() => expect(writes).toHaveLength(1))
    await screen.findByText(/may already have changed local records/)
    expect(screen.queryByText('Password changed')).not.toBeInTheDocument()
    expect(screen.queryByText('All your sessions have been signed out. Sign in with your new password to continue.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current password')).toBe(fields.current)
    expect(screen.getByLabelText('New password')).toBe(fields.next)
    expect(fields.current).toHaveValue(oldPassword)
    expect(fields.next).toHaveValue(newPassword)
    expect(writes).toEqual([{ current_password: oldPassword, new_password: newPassword }])
  })

  it('guards two synchronous submits before rendering and freezes both pending password fields', async () => {
    let finish!: (value: Response) => void
    const pending = new Promise<Response>(done => { finish = done })
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (url === '/api/auth/password' && options.method === 'POST') {
        writes.push(JSON.parse(String(options.body)))
        return pending
      }
      return Promise.resolve(Response.json(operationalReads['/settings']))
    }))
    const fields = await showPasswordForm()
    act(() => { fireEvent.submit(fields.form); fireEvent.submit(fields.form) })
    expect(writes).toHaveLength(1)
    expect(fields.current).toBeDisabled()
    expect(fields.next).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    await act(async () => { finish(Response.json({ changed: true, reauthenticate: true })) })
    expect(await screen.findByText('Password changed')).toBeVisible()
  })

  it('does not repeat an uncertain password change and offers deliberate sign-in instead', async () => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/auth/password' && options.method === 'POST') {
        writes.push(JSON.parse(String(options.body)))
        return Response.json({})
      }
      return Response.json(operationalReads['/settings'])
    }))
    const fields = await showPasswordForm()
    fireEvent.submit(fields.form)
    await screen.findByText(/may already have changed local records/)
    fireEvent.submit(fields.form)
    expect(writes).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/')
    expect(screen.getByLabelText('Current password')).toBe(fields.current)
    expect(screen.getByLabelText('New password')).toBe(fields.next)
    expect(fields.current).toHaveValue(oldPassword)
    expect(fields.next).toHaveValue(newPassword)
  })

  it('keeps a verified pre-write current-password refusal correctable', async () => {
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/auth/password' && options.method === 'POST') {
        attempts++
        return attempts === 1 ? Response.json({ error: { code: 'current_password_invalid', message: 'The current password is incorrect' } }, { status: 403 }) : Response.json({ changed: true, reauthenticate: true })
      }
      return Response.json(operationalReads['/settings'])
    }))
    const fields = await showPasswordForm()
    fireEvent.submit(fields.form)
    await screen.findByText('The current password is incorrect')
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled()
    expect(fields.current).toHaveValue(oldPassword)
    fireEvent.change(fields.current, { target: { value: 'fictional corrected old password' } })
    fireEvent.submit(fields.form)
    expect(await screen.findByText('Password changed')).toBeVisible()
    expect(attempts).toBe(2)
  })

  it.each(['current_password_invalid', 'validation_failed'])('does not treat a 500 response carrying %s as a pre-write refusal', async (code) => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/auth/password' && options.method === 'POST') {
        writes.push(JSON.parse(String(options.body)))
        return Response.json({ error: { code, message: 'Fictional unverified server error' } }, { status: 500 })
      }
      return Response.json(operationalReads['/settings'])
    }))
    const fields = await showPasswordForm()
    fireEvent.submit(fields.form)
    await screen.findByText(/may already have changed local records/)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/')
    fireEvent.submit(fields.form)
    expect(writes).toHaveLength(1)
  })
})
