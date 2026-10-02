import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { RemindersPage } from './Operations'
import { coreReadRows } from '../test/page-records'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it.each(['en', 'nl'] as const)('retains the %s reminder key and form after uncertainty and verifies the explicit retry', async (locale) => {
  const requests: { key: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      const key = new Headers(options.headers).get('Idempotency-Key')!
      const body = JSON.parse(String(options.body))
      requests.push({ key, body })
      if (requests.length === 1) return new Response('<interrupted confirmation>', { status: 201 })
      return Response.json({ id: 41, prospect_id: null, status: 'open', ...body, creation_key: key, replayed: true })
    }
    const items = url.includes('/drafts') ? [{ ...coreReadRows.drafts, id: 1, prospect_name: 'Fictional person', campaign_name: 'Fictional campaign' }] : []
    return Response.json({ items, total: items.length, offset: 0, limit: 50 })
  }))
  const labels = locale === 'en' ? { open: 'New reminder', title: 'Reminder', conversation: 'Conversation', due: 'Due', submit: 'Create reminder', warning: /may already have changed local records/, reference: /Reminder retry reference:/ }
    : { open: 'Nieuwe herinnering', title: 'Herinnering', conversation: 'Gesprek', due: 'Tijdstip', submit: 'Herinnering aanmaken', warning: /mogelijk al lokale gegevens gewijzigd/, reference: /Herhaalreferentie voor herinnering:/ }
  render(<I18nProvider initialLocale={locale}><RemindersPage canEdit /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: labels.open }))
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByRole('option', { name: /Fictional person/ })
  fireEvent.change(within(dialog).getByLabelText(labels.conversation), { target: { value: '1' } })
  fireEvent.change(within(dialog).getByLabelText(labels.title), { target: { value: 'Private fictional reminder' } })
  fireEvent.change(within(dialog).getByLabelText((text) => text.startsWith(labels.due)), { target: { value: '2027-11-02T07:58' } })
  const form = within(dialog).getByLabelText(labels.title).closest('form')!
  fireEvent.submit(form)
  expect(await within(dialog).findByText(labels.warning)).toBeVisible()
  expect(screen.getByText(labels.reference)).toHaveTextContent(requests[0].key)
  expect(within(dialog).getByLabelText(labels.title)).toHaveValue('Private fictional reminder')
  expect(requests).toHaveLength(1)
  // Cancel removes the form, not the unresolved reference. Re-entering the
  // original values must still recover the same logical attempt.
  fireEvent.click(within(dialog).getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Annuleren' }))
  expect(screen.getByText(labels.reference)).toHaveTextContent(requests[0].key)
  fireEvent.click(screen.getByRole('button', { name: labels.open }))
  const retryDialog = screen.getByRole('dialog')
  await within(retryDialog).findByRole('option', { name: /Fictional person/ })
  fireEvent.change(within(retryDialog).getByLabelText(labels.conversation), { target: { value: '1' } })
  fireEvent.change(within(retryDialog).getByLabelText(labels.title), { target: { value: 'Private fictional reminder' } })
  fireEvent.change(within(retryDialog).getByLabelText((text) => text.startsWith(labels.due)), { target: { value: '2027-11-02T07:58' } })
  fireEvent.submit(within(retryDialog).getByLabelText(labels.title).closest('form')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(screen.queryByText(labels.reference)).not.toBeInTheDocument()
  // A confirmed completion, unlike an unreadable response, ends the attempt.
  fireEvent.click(screen.getByRole('button', { name: labels.open }))
  const next = screen.getByRole('dialog')
  await within(next).findByRole('option', { name: /Fictional person/ })
  fireEvent.change(within(next).getByLabelText(labels.conversation), { target: { value: '1' } })
  fireEvent.change(within(next).getByLabelText(labels.title), { target: { value: 'Different fictional reminder' } })
  fireEvent.change(within(next).getByLabelText((text) => text.startsWith(labels.due)), { target: { value: '2027-11-03T07:58' } })
  fireEvent.submit(within(next).getByLabelText(labels.title).closest('form')!)
  await waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[2].key).not.toBe(requests[0].key)
})
