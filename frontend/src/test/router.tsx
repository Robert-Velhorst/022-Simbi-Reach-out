import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ReactNode } from 'react'
import DraftLeaveGuard from '../components/DraftLeaveGuard'

export function renderWithRouter(children: ReactNode, initialEntries = ['/']) {
  const router = createMemoryRouter([{ path: '*', element: children }], { initialEntries })
  return { ...render(<RouterProvider router={router} />), router }
}

export function renderWithDraftGuard(children: ReactNode) {
  return renderWithRouter(<DraftLeaveGuard>{children}</DraftLeaveGuard>)
}
