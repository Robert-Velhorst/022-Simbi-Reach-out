import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { ownedResponseRequest } from './response-proxy.mjs'

for (const url of ['https://example.test/private', 'http://127.0.0.1:1/',
  '//example.test/private', '/\\example.test/private', '/ok\r\nHost: example.test',
  '/path#fragment', '', undefined]) {
  test(`refuses non-origin request target ${JSON.stringify(url)}`, () => {
    assert.throws(() => ownedResponseRequest(4180, { url, method: 'GET', headers: {} }),
      /Only origin-form/)
  })
}

for (const port of ['https://example.test', '0', '80', '65536', '4180/path', '1e4']) {
  test(`refuses invalid isolated port ${port}`, () => {
    assert.throws(() => ownedResponseRequest(port, { url: '/', method: 'GET', headers: {} }),
      /Invalid owned/)
  })
}

test('forwards the real path, query and body only to the owned loopback server', async () => {
  let observed
  const server = createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    observed = { url: incoming.url, host: incoming.headers.host,
      body: Buffer.concat(chunks).toString(), method: incoming.method }
    response.end('owned backend')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  try {
    const response = await new Promise((resolve, reject) => {
      const upstream = ownedResponseRequest(port, {
        url: '/api/templates?return=https%3A%2F%2Fexample.test', method: 'POST',
        headers: { host: 'example.test', 'content-type': 'text/plain' },
      }, resolve)
      upstream.once('error', reject)
      upstream.end('fictional body')
    })
    const chunks = []
    for await (const chunk of response) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString(), 'owned backend')
    assert.deepEqual(observed, {
      url: '/api/templates?return=https%3A%2F%2Fexample.test',
      host: `127.0.0.1:${port}`, body: 'fictional body', method: 'POST',
    })
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
