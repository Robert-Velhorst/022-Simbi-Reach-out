import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { TemplatesPage } from './Resources'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('unverified write feedback in a real resource form', () => {
  it.each(['en', 'nl'] as const)('keeps the %s form and authored fields after unreadable successful response', async (locale) => {
    const labels = locale === 'en' ? { open: 'New template', dialog: 'Create template', name: 'Template name', submit: 'Create template', unknown: /may already have changed local records/i }
      : { open: 'Nieuw sjabloon', dialog: 'Sjabloon aanmaken', name: 'Sjabloonnaam', submit: 'Sjabloon aanmaken', unknown: /mogelijk al lokale gegevens gewijzigd/i }
    const fetchMock = vi.fn(async (_url, options: RequestInit) => new Response(options?.method === 'POST' ? '<proxy body>' : '{"items":[],"offset":0,"total":0,"limit":50}'))
    vi.stubGlobal('fetch', fetchMock)
    render(<I18nProvider initialLocale={locale}><TemplatesPage canEdit /></I18nProvider>)
    fireEvent.click(await screen.findByRole('button', { name: labels.open }))
    const dialog = screen.getByRole('dialog', { name: labels.dialog })
    fireEvent.change(within(dialog).getByLabelText(labels.name), { target: { value: 'Private fixture title' } })
    fireEvent.click(within(dialog).getByRole('button', { name: labels.submit }))
    expect(await within(dialog).findByText(labels.unknown)).toBeVisible()
    expect(within(dialog).getByLabelText(labels.name)).toHaveValue('Private fixture title')
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })
})
