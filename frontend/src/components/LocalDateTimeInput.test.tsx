import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, LanguagePicker } from '../i18n'
import { RemindersPage } from '../pages/Operations'
import { LocalDateTimeInput, localDateTimeISO } from './LocalDateTimeInput'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('strict local reminder time', () => {
  it.each(['2027-11-02T07:58', '2028-02-29T00:00', '2000-02-29T23:59', '0001-01-01T12:34'])('converts valid local time %s to UTC', (value) => {
    expect(localDateTimeISO(value)).toBe(new Date(value).toISOString())
  })
  it.each(['', '2027-02-29T12:00', '1900-02-29T12:00', '2027-02-30T12:00', '2027-13-01T12:00', '2027-11-00T12:00', '2027-11-02T24:00', '2027-11-02T07:60', '2027-11-02', '2027-11-02T07:58Z', '2027-11-02T07:58+02:00', '0000-01-01T12:00'])('refuses invalid or nonlocal time %s', (value) => {
    expect(localDateTimeISO(value)).toBeNull()
  })
})

it('keeps native entry by default and preserves text across mode/language changes', () => {
  render(<I18nProvider initialLocale="en"><LanguagePicker /><LocalDateTimeInput name="due_at" /></I18nProvider>)
  expect(screen.getByLabelText('Due')).toHaveAttribute('type', 'datetime-local')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enter date and time as text' }))
  const due = screen.getByLabelText('Due')
  expect(due).toHaveAttribute('type', 'text')
  fireEvent.change(due, { target: { value: '2027-11-02T07:58' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Language / Taal' }), { target: { value: 'nl' } })
  expect(screen.getByLabelText('Tijdstip')).toHaveValue('2027-11-02T07:58')
  expect(screen.getByRole('checkbox', { name: 'Datum en tijd als tekst invoeren' })).toBeChecked()
  expect(screen.getByLabelText('Tijdstip')).toHaveAccessibleDescription(/lokale tijd van je browser/)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByLabelText('Tijdstip')).toHaveAttribute('type', 'datetime-local')
  expect(screen.getByLabelText('Tijdstip')).toHaveValue('2027-11-02T07:58')
})

it('labels invalid text without throwing away the value when native entry cannot display it', () => {
  render(<LocalDateTimeInput name="due_at" />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2027-02-30T12:00' } })
  expect(screen.getByLabelText('Due')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Due')).toHaveAccessibleDescription(/Enter a valid local date/)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByLabelText('Due')).toHaveValue('2027-02-30T12:00')
})

async function reminderForm() {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const body = url.includes('/drafts') ? { items: [{ id: 7, prospect_name: 'Fictional person', campaign_name: 'Fictional campaign' }], total: 1, limit: 50, offset: 0 } : { items: [], total: 0, limit: 50, offset: 0 }
    if (options.method === 'POST') writes.push(JSON.parse(String(options.body)))
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }))
  render(<RemindersPage canEdit />)
  fireEvent.click(screen.getByRole('button', { name: 'New reminder' }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('combobox')).toBeEnabled())
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '7' } })
  fireEvent.change(within(dialog).getByLabelText('Reminder'), { target: { value: 'Fictional reminder' } })
  fireEvent.click(within(dialog).getByRole('checkbox'))
  return { dialog, due: within(dialog).getByLabelText('Due'), writes }
}

it('saves exactly one reminder with the displayed text converted to UTC', async () => {
  const { due, writes } = await reminderForm()
  fireEvent.change(due, { target: { value: '2027-11-02T07:58' } })
  fireEvent.submit(due.closest('form')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(writes).toEqual([{ draft_id: 7, title: 'Fictional reminder', due_at: new Date('2027-11-02T07:58').toISOString() }])
})

it('rejects calendar rollover before any write, preserving the dialog/text and focusing its input', async () => {
  const { dialog, due, writes } = await reminderForm()
  fireEvent.change(due, { target: { value: '2027-02-30T12:00' } })
  fireEvent.submit(due.closest('form')!)
  expect(dialog).toBeInTheDocument()
  expect(due).toHaveValue('2027-02-30T12:00')
  expect(due).toHaveFocus()
  expect(writes).toEqual([])
})
