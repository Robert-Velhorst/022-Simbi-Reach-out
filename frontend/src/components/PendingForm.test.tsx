import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PendingForm } from './PendingForm'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['field', 'lost body', 'other control', 'background'] as const)('pending form focus is foreground and non-stealing: %s', (scenario) => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(scenario !== 'background')
  const content = (busy: boolean) => <><PendingForm busy={busy}><input aria-label="Pending field" /></PendingForm><button>Different control</button></>
  const view = render(content(false))
  if (scenario === 'field' || scenario === 'background') screen.getByRole('textbox').focus()
  else if (scenario === 'other control') screen.getByRole('button').focus()
  view.rerender(content(true))
  const form = screen.getByRole('textbox').closest('form')!
  if (scenario === 'field' || scenario === 'lost body') expect(form).toHaveFocus()
  else expect(form).not.toHaveFocus()
})
