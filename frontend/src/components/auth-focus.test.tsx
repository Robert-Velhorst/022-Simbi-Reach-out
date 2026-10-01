import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginScreen, SetupScreen } from './Auth'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function service() {
  let reject: () => void = () => {}
  const pending = new Promise<Response>((done) => { reject = () => done(new Response(JSON.stringify({ error: { code: 'fixture_refused', message: 'Fictional sign-in or setup refused' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })) })
  const fetcher = vi.fn(() => pending)
  vi.stubGlobal('fetch', fetcher)
  return { reject, fetcher }
}

describe.each(['setup', 'login'] as const)('rejected %s submitting-control focus', (mode) => {
  function fixture() {
    const serviceFixture = service()
    const complete = vi.fn()
    render(mode === 'setup' ? <SetupScreen onComplete={complete} setupTokenRequired /> : <LoginScreen onComplete={complete} />)
    const button = screen.getByRole('button', { name: mode === 'setup' ? 'Create workspace' : 'Sign in' })
    const form = button.closest('form')!
    const password = form.querySelector<HTMLInputElement>('[name=password]')!
    fireEvent.change(password, { target: { value: 'fictional input retained after refusal' } })
    button.focus()
    fireEvent.submit(form)
    expect(button).toBeDisabled()
    return { ...serviceFixture, complete, button, password }
  }

  it('restores after BODY focus loss and keeps the authored input', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const controls = fixture()
    const other = screen.getByRole('combobox', { name: 'Language / Taal' })
    other.focus(); other.blur() // Model the native disabled-submit focus loss.
    expect(document.body).toHaveFocus()
    controls.reject()
    await screen.findByText('Fictional sign-in or setup refused')
    await waitFor(() => expect(controls.button).toHaveFocus())
    expect(controls.password).toHaveValue('fictional input retained after refusal')
    expect(controls.complete).not.toHaveBeenCalled()
    expect(controls.fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus moved to another control', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const controls = fixture()
    controls.password.focus()
    controls.reject()
    await screen.findByText('Fictional sign-in or setup refused')
    expect(controls.password).toHaveFocus()
    expect(controls.button).toBeEnabled()
  })

  it('does not restore focus while the document is in the background', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const controls = fixture()
    const other = screen.getByRole('combobox', { name: 'Language / Taal' })
    other.focus(); other.blur()
    controls.reject()
    await screen.findByText('Fictional sign-in or setup refused')
    expect(document.body).toHaveFocus()
    expect(controls.button).toBeEnabled()
  })
})
