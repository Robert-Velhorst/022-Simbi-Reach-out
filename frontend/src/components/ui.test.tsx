import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal, Notice, Status, TableRegion } from './ui'

afterEach(() => { cleanup(); document.body.style.overflow = '' })

function ModalWorkflow({ allowClose = true }: { allowClose?: boolean }) {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Inspect record</button>{open ? <Modal title="Record" onClose={() => { if (allowClose) setOpen(false) }}><input aria-label="Record note" /></Modal> : null}</>
}

function ReplacingTriggerWorkflow() {
  const [open, setOpen] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <><button key={String(prepared)} ref={trigger} onClick={() => setOpen(true)}>{prepared ? 'Resolve handoff' : 'Prepare handoff'}</button>{open ? <Modal title="Handoff" returnFocusRef={trigger} onClose={() => setOpen(false)}><button onClick={() => setPrepared(true)}>Load finished</button></Modal> : null}</>
}

describe('shared UI', () => {
  it.each(['', 'scroll'])('keeps scrolling locked when an older dialog closes, then restores the original %s overflow', (original) => {
    document.body.style.overflow = original
    const view = render(<><Modal key="older" title="Navigation" onClose={() => {}}>Links</Modal><Modal key="newer" title="Leave warning" onClose={() => {}}>Keep editing</Modal></>)
    expect(document.body.style.overflow).toBe('hidden')
    view.rerender(<><Modal key="newer" title="Leave warning" onClose={() => {}}>Keep editing</Modal></>)
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(document.body.style.overflow).toBe(original)
  })
  it('provides a named keyboard-focusable table region without replacing table semantics', async () => {
    render(<TableRegion label="Audit log"><table><thead><tr><th>Event</th></tr></thead><tbody><tr><td>Fictional event</td></tr></tbody></table></TableRegion>)
    await userEvent.tab()
    expect(screen.getByRole('region', { name: 'Audit log' })).toHaveFocus()
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeVisible()
  })
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

  it('moves focus into the dialog and restores the trigger on close', async () => {
    render(<ModalWorkflow />)
    const trigger = screen.getByRole('button', { name: 'Inspect record' })
    await userEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('prevents backdrop mousedown from overwriting restored focus', async () => {
    render(<ModalWorkflow />)
    const trigger = screen.getByRole('button', { name: 'Inspect record' })
    await userEvent.click(trigger)
    const dismissed = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: -1, clientY: -1 })
    fireEvent(screen.getByRole('dialog'), dismissed)
    expect(dismissed.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('routes platform cancellation through the current close permission', async () => {
    const view = render(<ModalWorkflow allowClose={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Inspect record' }))
    const denied = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), denied)
    expect(denied.defaultPrevented).toBe(true)
    expect(screen.getByRole('dialog')).toBeVisible()
    view.rerender(<ModalWorkflow allowClose />)
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect record' })).toHaveFocus()
  })

  it('restores the replacement action when the original trigger is removed', async () => {
    render(<ReplacingTriggerWorkflow />)
    await userEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }))
    await userEvent.click(screen.getByRole('button', { name: 'Load finished' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Resolve handoff' })).toHaveFocus()
  })
})
