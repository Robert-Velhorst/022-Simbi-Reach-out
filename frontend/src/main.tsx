import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './i18n'
import './styles.css'

// A data router supplies native route/history blockers without replacing or
// monkey-patching browser history. Existing nested routes and deep links remain.
const router = createBrowserRouter([{ path: '*', element: <I18nProvider><App /></I18nProvider> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
