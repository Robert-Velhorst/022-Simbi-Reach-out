import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test/router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'
import type { Member } from '../types'

vi.mock('../pages/Dashboard', () => ({ default: () => <h1>Overview content</h1> }))
vi.mock('../pages/Resources', () => ({ ProspectsPage: () => <h1>Prospects content</h1>, CampaignsPage: () => <h1>Campaigns content</h1>, TemplatesPage: () => <h1>Templates content</h1> }))

const member: Member = { user_id: 1, email: 'qa@example.test', display_name: 'QA', workspace_id: 1, workspace_name: 'QA', role: 'owner', mode: 'assisted', compliance_ack_at: null, paused_at: null, environment: 'test', demo_mode: false }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function show() { return renderWithRouter(<AppShell member={member} onMemberChange={() => {}} onSignedOut={() => {}} />) }

describe('keyboard navigation', () => {
  it('offers a first-tab bypass without changing the route or records', async () => {
    show()
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Overview content' })).toBeVisible()
  })

  it('opens a named native navigation dialog and restores focus on cancellation', async () => {
    show()
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Primary navigation' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog).toHaveAttribute('id', trigger.getAttribute('aria-controls'))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves focus to the new content after choosing a drawer route, including the same route', async () => {
    show()
    for (const [label, heading] of [['Prospects', 'Prospects content'], ['Prospects', 'Prospects content'], ['Campaigns', 'Campaigns content']]) {
      await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: label }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
      expect(screen.getByRole('main')).toHaveFocus()
    }
  })

  it('focuses destination content for desktop navigation', async () => {
    show()
    await userEvent.click(screen.getByRole('link', { name: 'Prospects' }))
    expect(screen.getByRole('main')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Prospects content' })).toBeVisible()
  })

  it('closes an open drawer at the desktop breakpoint and removes its listener', async () => {
    const remove = vi.fn()
    let resize: ((event: { matches: boolean }) => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: (_type: string, callback: typeof resize) => { resize = callback }, removeEventListener: remove })))
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(resize).toBeDefined()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(remove).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent(window, new Event('resize'))
    // The media query's change event, not arbitrary resize noise, closes the drawer.
    expect(screen.getByRole('dialog')).toBeVisible()
    const { act } = await import('@testing-library/react')
    await act(async () => { resize?.({ matches: false }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
