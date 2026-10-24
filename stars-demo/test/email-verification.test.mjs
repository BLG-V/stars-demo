import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitHealth = async (base, child) => { for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('api exited'); try { if ((await fetch(base + '/api/health')).ok) return } catch { void 0 } await wait(25) }; throw new Error('health timeout') }

test('email registration requires a real code, consumes it once, and never persists plaintext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-email-'))
  const captureFile = join(dir, 'mail.txt')
  const port = 19800 + Math.floor(Math.random() * 100)
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), STARS_STORAGE: 'json', STARS_DATA_FILE: join(dir, 'stars.json'), REQUIRE_EMAIL_VERIFICATION: 'true', SMTP_HOST: 'capture', SMTP_FROM: 'Stars <stars@example.test>', SMTP_CAPTURE_FILE: captureFile, ALLOW_STUB_MODEL: 'false' } })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk.toString() })
  child.stderr.on('data', chunk => { logs += chunk.toString() })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitHealth(base, child)
    const email = 'verified@example.test'
    const requestCode = () => fetch(base + '/api/auth/register/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
    const requestResponse = await requestCode()
    assert.equal(requestResponse.status, 202, logs)
    let emailBody = ''; for (let i = 0; i < 40; i++) { try { emailBody = await readFile(captureFile, 'utf8'); if (/>(\d{6})<\/p>/.test(emailBody)) break } catch { void 0 } await wait(50) }
    const code = emailBody.match(/font-size:24px[^>]*>(\d{6})</)?.[1]
    assert.match(code || '', /^\d{6}$/, logs + ' capture=' + emailBody)
    const invalid = await fetch(base + '/api/auth/register/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: '000000', password: 'password123' }) })
    assert.equal(invalid.status, 400)
    const verified = await fetch(base + '/api/auth/register/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code, password: 'password123' }) })
    assert.equal(verified.status, 201)
    const replay = await fetch(base + '/api/auth/register/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code, password: 'password123' }) })
    assert.equal(replay.status, 400)
    const saved = await readFile(join(dir, 'stars.json'), 'utf8')
    assert.doesNotMatch(saved, new RegExp(code))
    assert.match(saved, /verified@example.test/)
  } finally { child.kill(); await unlink(captureFile).catch(() => {}) }
})

test('production direct registration is rejected without verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-email-prod-')); const port = 19900 + Math.floor(Math.random() * 50)
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), STARS_STORAGE: 'json', STARS_DATA_FILE: join(dir, 'stars.json'), NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'true', ALLOW_STUB_MODEL: 'false' } })
  try { const base = `http://127.0.0.1:${port}`; await waitHealth(base, child); const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'direct@example.test', password: 'password123' }) }); assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'EMAIL_VERIFICATION_REQUIRED') } finally { child.kill() }
})
