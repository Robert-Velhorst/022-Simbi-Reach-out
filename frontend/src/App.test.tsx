import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('application bootstrap', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows retirement instead of sign-in or fresh setup and never asks for private account data', async () => {
    const fetchMock = vi.fn(async () => Response.json({ setup_required: false, installation_retired: true, environment: 'test', demo_mode: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Local installation retired' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('shows a truthful retry state when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Service unavailable' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByText('No outreach action was attempted.')).toBeVisible()
  })

  it.each(['service', 'network'])('does not disguise a %s failure during session lookup as a sign-out', async (failure) => {
    let recovered = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/status') return Response.json({ setup_required: false, environment: 'test', demo_mode: false })
      if (url !== '/api/me') throw new Error(`Unexpected request: ${url}`)
      if (recovered) return Response.json({ error: { code: 'session_expired', message: 'Sign in again' } }, { status: 401 })
      if (failure === 'network') throw new TypeError('Connection lost')
      return Response.json({ error: { code: 'service_unavailable', message: 'Service unavailable during session lookup' } }, { status: 503 })
    }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Service unavailable' })).toBeVisible()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    recovered = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it.each(['authentication_required', 'session_expired'])('offers sign-in when the server confirms %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/status'
      ? Response.json({ setup_required: false, environment: 'test', demo_mode: false })
      : Response.json({ error: { code, message: 'Sign in to continue' } }, { status: 401 })))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
