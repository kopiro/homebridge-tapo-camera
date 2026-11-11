const assert = require('node:assert/strict');
const { test } = require('node:test');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { TAPOCamera } = require('../dist/tapoCamera');

test('camera requests use bundled Undici with the self-signed TLS agent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tapo-transport-'));
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'],
  { stdio: 'ignore' });
  const requests = [];
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) },
    async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ method: req.method, headers: req.headers, body });
      const payload = JSON.stringify({ error_code: 0 });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    });
  const camera = new TAPOCamera({}, { ipAddress: '127.0.0.1', password: 'test-password' });
  const nativeFetch = globalThis.fetch;
  // Future Node versions may bundle a dispatcher API incompatible with Undici 6.
  globalThis.fetch = () => { throw new Error('Must not use Node built-in fetch'); };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `https://127.0.0.1:${server.address().port}`;
    const response = await camera.fetch(url, { method: 'POST', body: '{"method":"login"}' });
    assert.deepEqual(await response.json(), { error_code: 0 });
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].body, '{"method":"login"}');
    assert.equal(requests[0].headers.requestbyapp, 'true');
    assert.equal(requests[0].headers['content-type'], 'application/json; charset=UTF-8');
    const override = await camera.fetch(url, { method: 'POST', headers: { 'X-Tapo-Test': 'override' } });
    await override.text();
    assert.equal(requests[1].headers['x-tapo-test'], 'override');

  } finally {
    globalThis.fetch = nativeFetch;
    await camera.fetchAgent.close();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
