import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal, Notice, Status } from './ui'

describe('shared UI', () => {
  it('announces notices and formats statuses', () => {
    render(<><Notice tone="warning">Review required</Notice><Status value="needs_review" /></>)
    expect(screen.getByRole('status')).toHaveTextContent('Review required')
    expect(screen.getByText('needs review')).toBeVisible()
  })

  it('closes a modal from its labelled button', async () => {
    const close = vi.fn()
    render(<Modal title="Safety review" onClose={close}>Content</Modal>)
    expect(screen.getByRole('dialog', { name: 'Safety review' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
