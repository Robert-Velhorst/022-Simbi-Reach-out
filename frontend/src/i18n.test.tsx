import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from './locales/en.json'
import nl from './locales/nl.json'
import { I18nProvider, LANGUAGE_STORAGE_KEY, LanguagePicker, readLocale, translate, useI18n } from './i18n'
import ReviewQueue from './pages/ReviewQueue'
import { ProspectsPage } from './pages/Resources'
import { SetupScreen } from './components/Auth'
import type { Draft, Member } from './types'

// Node 25's experimental global storage can shadow jsdom. Unit tests use an
// explicit browser-shaped fixture; Chromium acceptance proves real persistence.
class TestStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}
beforeEach(() => { vi.stubGlobal('localStorage', new TestStorage()) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); vi.unstubAllGlobals(); document.documentElement.lang = 'en' })
const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]).sort()
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const member: Member = { user_id: 1, email: 'owner@example.test', display_name: 'Owner', workspace_id: 1, workspace_name: 'Test', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-09-05', paused_at: null, environment: 'test', demo_mode: false }

function Probe() {
  const { t, formatDate, formatCode, formatMessage } = useI18n()
  const [note, setNote] = useState('My original content $& {name}')
  return <><LanguagePicker /><h1>{t('Overview')}</h1><input aria-label="original" value={note} onChange={(event) => setNote(event.target.value)} /><p>{formatDate('2026-09-05T12:00:00Z')}</p><p>{formatDate(null)}</p><p>{formatDate('original invalid date')}</p><p>{formatCode('needs_review')}</p><p>{formatMessage('opaque provider diagnostic $&')}</p><p>{formatMessage({ key: '{count} row(s) need attention. First error: line {line} — {detail}', params: { count: 1, line: 2 }, detail: 'Name is required' })}</p></>
}

describe('English and Dutch catalogs', () => {
  it('have identical keys, nonempty values and exactly preserved interpolation fields', () => {
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(nl[key].trim(), key).not.toBe('')
      expect(placeholders(nl[key]), key).toEqual(placeholders(en[key]))
    }
  })
  it('interpolates literal data without HTML parsing, recursive translation or replacement tokens', () => {
    const name = '<script>$& {count} English</script>'
    expect(translate('nl', 'Stop contact: {name}', { name })).toContain(name)
    render(<I18nProvider initialLocale="nl"><Probe /></I18nProvider>)
    expect(screen.getByDisplayValue('My original content $& {name}')).toBeVisible()
    expect(screen.getByText(/opaque provider diagnostic \$&/)).toBeVisible()
    expect(translate('nl', 'Stop contact: {name}')).toContain('{name}')
  })
  it('preserves canonical CSV and message-template placeholders in both languages', () => {
    for (const locale of ['en', 'nl'] as const) {
      expect(translate(locale, 'Required columns: name,source_url. Optional: organization,provider,contact_handle,notes,consent_status.')).toContain('organization,provider,contact_handle,notes,consent_status')
      for (const field of ['name', 'organization', 'campaign', 'notes']) {
        expect(translate(locale, 'Stop contact: {name}', { name: `{${field}}` })).toContain(`{${field}}`)
      }
    }
  })
})

describe('language preference and state preservation', () => {
  it('defaults to English for missing, invalid or inaccessible preferences', () => {
    expect(readLocale()).toBe('en')
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '{invalid}')
    expect(readLocale()).toBe('en')
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readLocale()).toBe('en')
  })
  it('changes labels and document language without remounting or writing any records', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<I18nProvider><Probe /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('original'), { target: { value: 'Unsaved not translated $& {name}' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language / Taal' }), { target: { value: 'nl' } })
    expect(screen.getByRole('heading', { name: 'Overzicht' })).toBeVisible()
    expect(screen.getByDisplayValue('Unsaved not translated $& {name}')).toBeVisible()
    expect(document.documentElement.lang).toBe('nl')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('nl')
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText('beoordeling nodig')).toBeVisible()
    expect(screen.getByText('Niet ingesteld')).toBeVisible()
    expect(screen.getByText('original invalid date')).toBeVisible()
    expect(screen.getByText(new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-09-05T12:00:00Z')))).toBeVisible()
    cleanup()
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByRole('heading', { name: 'Overzicht' })).toBeVisible()
  })
  it('switches in this tab even when saving the preference is denied', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    render(<I18nProvider><Probe /></I18nProvider>)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nl' } })
    expect(screen.getByRole('heading', { name: 'Overzicht' })).toBeVisible()
  })
  it('follows other-tab preference changes and clears back to English', () => {
    render(<I18nProvider><Probe /></I18nProvider>)
    act(() => { localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl'); window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY })) })
    expect(screen.getByRole('heading', { name: 'Overzicht' })).toBeVisible()
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })) })
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
  })
  it('keeps first-run inputs intact while switching before authentication', () => {
    render(<I18nProvider><SetupScreen onComplete={() => {}} /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'My original name' } })
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'unsaved secret stays local' } })
    fireEvent.change(screen.getAllByRole('combobox', { name: 'Language / Taal' })[0], { target: { value: 'nl' } })
    expect(screen.getByDisplayValue('My original name')).toBeVisible()
    expect(screen.getByDisplayValue('unsaved secret stays local')).toBeVisible()
  })
  it('keeps prospect modal input and canonical payload values while labels change', async () => {
    const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(async () => response({ items: [], total: 0, offset: 0, limit: 50 }))
    vi.stubGlobal('fetch', fetch)
    render(<I18nProvider><LanguagePicker /><ProspectsPage canEdit /></I18nProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add prospect' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Original English record' } })
    fireEvent.change(screen.getByLabelText('Consent context'), { target: { value: 'consented' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language / Taal' }), { target: { value: 'nl' } })
    expect(screen.getByDisplayValue('Original English record')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Context van toestemming' })).toHaveValue('consented')
    expect(fetch.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method || (call[1] as RequestInit).method === 'GET')).toBe(true)
  })
  it('keeps the review checks and unsaved message tied to the same saved hash', async () => {
    const draft: Draft = { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Original English', organization: '', source_url: 'https://simbi.com/original', consent_status: 'consented', campaign_name: 'Campaign', template_name: 'Template', subject: 'Subject', body: 'Untouched original body', state: 'needs_review', quality_score: 100, content_hash: 'same-hash', edit_version: 'b'.repeat(64), safety_flags: [], updated_at: '2026-09-05T12:00:00Z' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ items: url.includes('/drafts') ? [draft] : [], total: 1, offset: 0, limit: 50 })))
    render(<I18nProvider><LanguagePicker /><ReviewQueue member={member} onMemberChange={() => {}} /></I18nProvider>)
    await screen.findByLabelText('Message')
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    fireEvent.change(screen.getByRole('combobox', { name: 'Language / Taal' }), { target: { value: 'nl' } })
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true)
    fireEvent.change(screen.getByLabelText('Bericht'), { target: { value: 'Unsaved original $& {name}' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language / Taal' }), { target: { value: 'en' } })
    expect(screen.getByLabelText('Message')).toHaveValue('Unsaved original $& {name}')
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeDisabled()
  })
})
