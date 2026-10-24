import { request } from 'node:http'

// Only the test's numeric loopback port is configurable. Never resolve an
// incoming request target against a URL: an absolute target overrides its base.
export function ownedResponseRequest(port, incoming, onResponse) {
  const value = String(port)
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new TypeError('Invalid owned response backend port')
  }
  const path = incoming.url
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
      || /[\\\r\n#]/.test(path)) {
    throw new TypeError('Only origin-form response proxy targets are accepted')
  }
  return request({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: Number(value),
    path,
    method: incoming.method,
    headers: { ...incoming.headers, host: `127.0.0.1:${Number(value)}` },
  }, onResponse)
}
