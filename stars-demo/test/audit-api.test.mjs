import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
test('approval, disconnect replay and restart never repeat a paid model call or silently overwrite files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-audit-'))
  const file = join(dir, 'db.json')
  let providerCalls = 0
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) { void chunk /* Drain without logging private prompts. */ }
    providerCalls++
    await wait(180)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ files: [{ path: 'index.html', content: '<h1>approved</h1>' }] }) } }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const port = 19600 + Math.floor(Math.random() * 150)
  const base = `http://127.0.0.1:${port}/api`
  let child, output = ''
  const start = async () => {
    child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), STARS_DATA_FILE: file, STARS_STORAGE: 'json', MODEL_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, MODEL_NAME: 'audit-model', MODEL_API_KEY: 'audit-private-key', ALLOW_STUB_MODEL: 'false' } })
    child.stdout.on('data', chunk => { output += chunk.toString() })
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error('API startup failed')
      try { if ((await fetch(base + '/health')).ok) return } catch { /* Wait for startup. */ }
      await wait(25)
    }
    throw new Error('API startup timeout')
  }
  const stop = async () => { const exited = once(child, 'exit'); child.kill(); await exited }
  let cookie
  const request = (path, method = 'GET', body, extra = {}) => fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    await start()
    const auth = await request('/auth/register', 'POST', { email: 'private-audit@example.test', password: 'audit-password-123' })
    cookie = auth.headers.get('set-cookie').split(';')[0]
    const project = (await (await request('/projects', 'POST', { name: 'Audit' })).json()).project
    const path = `/projects/${project.id}`
    const plan = (await (await request(path + '/plans', 'POST', { prompt: 'private-audit-prompt' })).json()).plan
    assert.equal((await request(path + '/runs', 'POST', { prompt: plan.prompt })).status, 400)
    const body = { planId: plan.id, idempotencyKey: plan.id }
    const stream = await request(path + '/runs', 'POST', body)
    const reader = stream.body.getReader()
    await reader.read()
    await reader.cancel()
    const duplicate = await request(path + '/runs', 'POST', body)
    assert.equal(duplicate.status, 200)
    await duplicate.text()
    await wait(300)
    const state = await (await request(path)).json()
    assert.equal(providerCalls, 1)
    assert.equal(state.files.length, 0)
    assert.equal(state.runs[0].status, 'review')
    const events = state.runs[0].details.events
    assert.deepEqual(events.map(event => event.id), events.map((_, i) => i + 1))
    const replay = await (await request(path + '/runs', 'POST', body, { 'Last-Event-ID': '2' })).text()
    assert.doesNotMatch(replay, /event: queued|event: planning/)
    assert.match(replay, /event: review/)
    assert.equal((await request(path + '/files', 'PUT', { path: 'index.html', content: 'racing edit' })).status, 409)
    await stop()
    await start()
    assert.equal((await (await request(path)).json()).runs[0].status, 'review')
    for (let i = 0; i < 2; i++) assert.equal((await request(path + `/runs/${plan.id}/approve`, 'POST')).status, 200)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.fileChanges.length, 1)
    assert.equal(saved.runs.length, 1)
    assert.equal(saved.runs[0].details.events.filter(event => event.type === 'done').length, 1)
    assert.equal(providerCalls, 1)
    for (const content of ['<img src="//192.168.1.1:80/x">', '<img src="//[::1]:8080/x">', '<img src="%252f%252flocalhost/x">', '<a href="&amp;#47;&amp;#47;127.0.0.1/x">x</a>', 'const url="\\u002f\\u002f127.0.0.1/x"', '<a href="https:/\\evil.example">x</a>', '<a href="h\tttps://evil.example">x</a>', '<a href="https:evil.example">x</a>', '<img src="\\\\127.0.0.1/x">']) {
      const response = await request(path + '/files', 'PUT', { path: 'index.html', content })
      assert.equal(response.status, 422)
      assert.equal((await response.json()).error.code, 'UNSAFE_FILE_CONTENT')
    }
    const invalid = await request(path + '/plans', 'POST', { prompt: '' })
    const invalidBody = await invalid.json()
    assert.equal(invalid.headers.get('x-request-id'), invalidBody.error.requestId)
    await wait(30)
    const logs = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    assert.ok(logs.some(log => log.requestId === invalidBody.error.requestId && log.errorCode === 'INVALID_INPUT' && log.projectId === project.id && typeof log.durationMs === 'number'))
    assert.ok(logs.some(log => log.event === 'run_finished' && log.runId === plan.id && log.runStatus === 'review'))
    assert.ok(logs.some(log => log.runId === plan.id && log.runStatus === 'done' && log.status === 200))
    assert.doesNotMatch(output, /private-audit@example|audit-password-123|private-audit-prompt|audit-private-key/)
  } finally {
    if (child && child.exitCode === null) await stop()
    await new Promise(resolve => provider.close(resolve))
  }
})
