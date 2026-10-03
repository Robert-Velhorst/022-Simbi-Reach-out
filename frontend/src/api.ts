import { validCoreCreation } from './coreResponse'
import { validPageRecords } from './pageRecords'
import { validOperationalRead } from './operationalReads'
import { validSafetyMutation } from './safetyMutations'

export class ApiError extends Error {
  code: string
  details: unknown
  status?: number

  constructor(code: string, message: string, details?: unknown, status?: number) {
    super(message)
    this.code = code
    this.details = details
    this.status = status
  }
}

function cookie(name: string): string {
  const prefix = `${name}=`
  return document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length) ?? ''
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const writes = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  const unknownWrite = 'The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'
  if (options.signal?.aborted) throw new ApiError('request_cancelled', 'The request was cancelled before it was sent. No change was requested.')
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (writes) {
    headers.set('X-CSRF-Token', decodeURIComponent(cookie('simbi_csrf')))
  }
  const controller = new AbortController()
  let interrupt!: (cause: ApiError) => void
  const interruption = new Promise<never>((_resolve, reject) => { interrupt = reject })
  const cancel = () => {
    interrupt(new ApiError('request_cancelled', writes ? unknownWrite : 'The request was cancelled. No result was loaded.'))
    controller.abort()
  }
  const timeout = window.setTimeout(() => {
    interrupt(new ApiError('request_timeout', writes ? unknownWrite : 'The request timed out. Check the service and try again.'))
    controller.abort()
  }, 20_000)
  options.signal?.addEventListener('abort', cancel, { once: true })
  try {
    // The deadline covers headers AND the body. Racing also bounds a body reader
    // that does not cooperate with abort; no request is automatically retried.
    return await Promise.race([interruption, (async () => {
      let response: Response
      try {
        response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include', signal: controller.signal })
      } catch {
        throw new ApiError('network_unavailable', writes ? unknownWrite : 'The local service is unavailable. Check that it is running and try again.')
      }
      let payload: unknown
      try { payload = await response.json() } catch {
        // Do not retain parser errors or raw response bodies: they can contain
        // private content, and an unreadable response is not a save receipt.
        if (response.ok) throw new ApiError('response_unverified', writes ? unknownWrite : 'The local service returned an unreadable response. Reload the current records; no result was verified.')
      }
      if (!response.ok) {
        const envelope = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined
        const error = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {}
        const code = typeof error.code === 'string' && error.code ? error.code : 'request_failed'
        // Only these inspected pre-mutation guards establish non-application.
        // A well-formed arbitrary 5xx envelope does not establish rollback.
        const confirmedRefusal = ['privacy_backup_failed', 'retirement_maintenance_busy'].includes(code)
        const message = writes && response.status >= 500 && (!confirmedRefusal || typeof error.message !== 'string' || !error.message)
          ? unknownWrite : typeof error.message === 'string' && error.message ? error.message : 'The request failed'
        throw new ApiError(code, message, error.details, response.status)
      }
      if (payload === null || typeof payload !== 'object') {
        throw new ApiError('response_unverified', writes ? unknownWrite : 'The local service returned an unreadable response. Reload the current records; no result was verified.')
      }
      if (method.toUpperCase() === 'GET' && !validPageRecords(path, payload)) {
        throw new ApiError('response_unverified', 'The local service returned an unverified record list. Retry this read without reloading or resubmitting a change; no result was verified.')
      }
      if (method.toUpperCase() === 'GET' && !validOperationalRead(path, payload)) {
        throw new ApiError('response_unverified', 'The local service returned an unverified operational response. Retry only this read; do not reload or repeat a change. No result was verified.')
      }
      if (!validCoreCreation(path, method, options.body, payload)) {
        throw new ApiError('response_unverified', unknownWrite)
      }
      if (!validSafetyMutation(path, method, options.body, payload)) {
        throw new ApiError('response_unverified', unknownWrite)
      }
      if (path.split('?')[0] === '/auth/password' && method.toUpperCase() === 'POST') {
        const confirmation = payload as Record<string, unknown>
        if (confirmation.changed !== true || confirmation.reauthenticate !== true) {
          throw new ApiError('response_unverified', unknownWrite)
        }
      }
      if (/^\/handoffs\/[^/]+\/outcome$/.test(path.split('?')[0]) && method.toUpperCase() === 'POST') {
        let requested: unknown
        try { requested = typeof options.body === 'string' ? JSON.parse(options.body)?.outcome : undefined } catch { /* An unreadable request cannot bind a confirmation. */ }
        const states: Record<string, string> = { sent: 'sent', ambiguous: 'ambiguous', cancelled: 'approved' }
        const receipt = payload as Record<string, unknown>
        if (typeof requested !== 'string' || !Object.hasOwn(states, requested) || receipt.status !== requested || receipt.draft_state !== states[requested]) {
          throw new ApiError('response_unverified', unknownWrite)
        }
      }
      const creationPath = path.split('?')[0]
      // CSV preview is read-only and does not consume a creation reference.
      const keyedCreation = ['/campaigns', '/prospects', '/templates', '/drafts', '/replies', '/reminders'].includes(creationPath)
        || (creationPath === '/prospects/import' && typeof options.body === 'string' && JSON.parse(options.body).commit === true)
      if (keyedCreation && method.toUpperCase() === 'POST' && headers.has('Idempotency-Key')) {
        const receipt = payload as Record<string, unknown>
        if (receipt.creation_key !== headers.get('Idempotency-Key') || typeof receipt.replayed !== 'boolean') {
          throw new ApiError('response_unverified', unknownWrite)
        }
      }
      // Other endpoint-specific field/version/receipt checks remain necessary.
      return payload as T
    })()])
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}

export function post<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body), headers })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}
