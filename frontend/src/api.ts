export class ApiError extends Error {
  code: string
  details: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
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
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers.set('X-CSRF-Token', decodeURIComponent(cookie('simbi_csrf')))
  }
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = payload.error ?? {}
    throw new ApiError(error.code ?? 'request_failed', error.message ?? 'The request failed', error.details)
  }
  return payload as T
}

export function post<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body), headers })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}
