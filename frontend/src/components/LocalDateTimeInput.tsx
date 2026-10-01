import { useId, useState } from 'react'
import { useI18n } from '../i18n'
import { Field, Input } from './ui'

// Reject calendar rollover, offsets and nonexistent local wall times rather
// than silently scheduling a different date. The API still receives UTC ISO.
export function localDateTimeISO(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const date = new Date(value)
  if (year < 1 || !Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null
  return date.toISOString()
}

export function LocalDateTimeInput({ name }: { name: string }) {
  const { t } = useI18n()
  const hintId = useId()
  const errorId = useId()
  const [textEntry, setTextEntry] = useState(false)
  const [value, setValue] = useState('')
  const invalid = Boolean(value && !localDateTimeISO(value))
  return <>
    <label className="check-row"><input type="checkbox" checked={textEntry} onChange={(event) => setTextEntry(event.target.checked)} />{t('Enter date and time as text')}</label>
    <Field label={t('Due')}>
      <Input name={name} type={textEntry ? 'text' : 'datetime-local'} required value={value} onChange={(event) => setValue(event.target.value)} aria-label={t('Due')} aria-invalid={invalid || undefined} aria-describedby={[textEntry ? hintId : '', invalid ? errorId : ''].filter(Boolean).join(' ') || undefined} />
      {textEntry ? <small id={hintId}>{t("Use YYYY-MM-DDTHH:mm in your browser's local time, for example 2027-11-02T07:58.")}</small> : null}
      {invalid ? <small id={errorId} className="field-error">{t('Enter a valid local date and time using YYYY-MM-DDTHH:mm.')}</small> : null}
    </Field>
  </>
}
