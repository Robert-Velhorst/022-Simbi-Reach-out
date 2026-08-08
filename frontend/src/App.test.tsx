import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('application bootstrap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows a truthful retry state when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Service unavailable' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByText('No outreach action was attempted.')).toBeVisible()
  })
})
