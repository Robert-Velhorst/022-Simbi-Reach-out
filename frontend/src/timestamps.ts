// Match backend/app/timestamps.py without browser-specific string parsing.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|([+-])([01]\d|2[0-3]):([0-5]\d))$/

export function parseTimestamp(value: unknown): { milliseconds: number; instantKey: string } | null {
  if (typeof value !== 'string') return null
  const parts = TIMESTAMP.exec(value)
  if (!parts || Number(parts[1]) < 1) return null
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
  const fraction = (parts[7] ?? '').padEnd(6, '0')
  // setUTCFullYear avoids Date.UTC's special handling of years 0–99.
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return null
  calendar.setUTCHours(Number(parts[4]), Number(parts[5]), Number(parts[6]), Number(fraction.slice(0, 3)))
  const offset = parts[8] === 'Z' ? 0 : (parts[9] === '-' ? -1 : 1) * (Number(parts[10]) * 60 + Number(parts[11]))
  const milliseconds = calendar.getTime() - offset * 60_000
  const utcYear = new Date(milliseconds).getUTCFullYear()
  if (!Number.isFinite(milliseconds) || utcYear < 1 || utcYear > 9999) return null
  // Date displays milliseconds; confirmations also retain the last three
  // fractional digits so adjacent microseconds never compare as equal.
  return { milliseconds, instantKey: `${milliseconds}:${fraction.slice(3)}` }
}
