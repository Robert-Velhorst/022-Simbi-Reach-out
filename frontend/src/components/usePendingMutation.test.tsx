import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePendingMutation } from './usePendingMutation'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['lost body', 'other control', 'background'] as const)('row mutation restores only foreground lost-body focus: %s', (scenario) => {
  let finish!: () => void
  function Workflow() {
    const action = usePendingMutation()
    finish = action.end
    return <><button disabled={action.busy} onClick={() => action.begin()}>Change local status</button><button>Different control</button></>
  }
  vi.spyOn(document, 'hasFocus').mockReturnValue(scenario !== 'background')
  render(<Workflow />)
  const trigger = screen.getByRole('button', { name: 'Change local status' })
  trigger.focus()
  fireEvent.click(trigger)
  expect(trigger).toBeDisabled()
  if (scenario === 'other control') screen.getByRole('button', { name: 'Different control' }).focus()
  else { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex') }
  act(finish)
  expect(trigger).toBeEnabled()
  if (scenario === 'lost body') expect(trigger).toHaveFocus()
  else expect(trigger).not.toHaveFocus()
})
