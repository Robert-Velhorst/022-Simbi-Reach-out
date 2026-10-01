import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseTimestamp } from './timestamps'

afterEach(() => vi.restoreAllMocks())

describe('timezone-explicit stored instants', () => {
  it.each([null, undefined, 0, true, {}, [], '', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-32T00:00:00Z', '2026-01-01T00:00:00+00:60', '2026-01-01t00:00:00z', '2026-01-01T00:00:00Z\n'])('never coerces or infers an instant from %j', (value) => {
    expect(parseTimestamp(value)).toBeNull()
  })
  it.each([
    ['0001-01-01T00:01:00+00:01', '0001-01-01T00:00:00.000Z'],
    ['9999-12-31T23:58:59.999999-00:01', '9999-12-31T23:59:59.999Z'],
    ['2026-10-02T00:00:00.000001+23:59', '2026-10-01T00:01:00.000Z'],
    ['2026-10-01T00:00:00.9-23:59', '2026-10-01T23:59:00.900Z'],
    ['0099-02-28T00:00:00Z', '0099-02-28T00:00:00.000Z'],
  ])('matches the explicit UTC instant of %s without Date.parse', (value, utc) => {
    const parse = vi.spyOn(Date, 'parse').mockImplementation(() => { throw new Error('No heuristic parsing') })
    const result = parseTimestamp(value)
    expect(result).not.toBeNull()
    expect(new Date(result!.milliseconds).toISOString()).toBe(utc)
    expect(parse).not.toHaveBeenCalled()
  })
  it('compares equivalent offsets and six-digit precision, not rounded Date values', () => {
    expect(parseTimestamp('2026-10-02T00:00:00.123456+02:00')?.instantKey).toBe(parseTimestamp('2026-10-01T22:00:00.123456Z')?.instantKey)
    expect(parseTimestamp('2026-10-01T22:00:00.123456Z')?.instantKey).not.toBe(parseTimestamp('2026-10-01T22:00:00.123457Z')?.instantKey)
    expect(parseTimestamp('2026-10-01T22:00:00.1Z')?.instantKey).toBe(parseTimestamp('2026-10-01T22:00:00.100000-00:00')?.instantKey)
  })
})
