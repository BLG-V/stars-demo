import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function waitForHealth(base, child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error('API process exited before becoming healthy')
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch { /* API is still starting. */ }
    await wait(50)
  }
  throw new Error('API did not become healthy in time')
}
async function planRun(base, projectId, cookie, prompt) {
  const response = await fetch(`${base}/api/projects/${projectId}/plans`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ prompt }) })
  assert.equal(response.status, 201)
  return (await response.json()).plan.id
}
test('API registers, isolates projects and persists local data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-api-'))
  const port = 18987 + Math.floor(Math.random() * 100)
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ALLOW_STUB_MODEL: 'true', STARS_STORAGE: 'json', STARS_DATA_FILE: join(dir, 'stars.json') } })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, child)
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'test@example.com', password: 'password123' }) })
    assert.equal(register.status, 201)
    const cookie = register.headers.get('set-cookie').split(';')[0]
    const create = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Test', initialPrompt: 'Build a page' }) })
    assert.equal(create.status, 201)
    const project = (await create.json()).project
    const list = await fetch(`${base}/api/projects`, { headers: { cookie } })
    assert.equal((await list.json()).projects[0].id, project.id)
    const planId = await planRun(base, project.id, cookie, 'Build a greeting page')
    const run = await fetch(`${base}/api/projects/${project.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ planId, idempotencyKey: planId }) })
    assert.equal(run.status, 200)
    const runEvents = await run.text()
    assert.match(runEvents, /event: review/)
    assert.match(runEvents, /"devMode":true/)
    const approve = await fetch(`${base}/api/projects/${project.id}/runs/${planId}/approve`, { method: 'POST', headers: { cookie } })
    assert.equal(approve.status, 200)
    const snapshotResponse = await fetch(`${base}/api/projects/${project.id}/snapshots`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'v1' }) })
    assert.equal(snapshotResponse.status, 201)
    const snapshot = (await snapshotResponse.json()).snapshot
    const restore = await fetch(`${base}/api/projects/${project.id}/snapshots/${snapshot.id}/restore`, { method: 'POST', headers: { cookie } })
    assert.equal(restore.status, 200)
    assert.ok((await restore.json()).files.length > 0)
    const rename = await fetch(`${base}/api/projects/${project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Renamed Test' }) })
    assert.equal(rename.status, 200)
    assert.equal((await rename.json()).project.name, 'Renamed Test')
    const edit = await fetch(`${base}/api/projects/${project.id}/files`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ path: 'README.md', content: '# Edited\n\nSaved from the editor.' }) })
    assert.equal(edit.status, 200)
    assert.equal((await edit.json()).file.path, 'README.md')
    const editedProject = await (await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie } })).json()
    assert.match(editedProject.files.find(file => file.path === 'README.md').content, /Saved from the editor/)
    const secondRegister = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'other@example.com', password: 'password123' }) })
    assert.equal(secondRegister.status, 201)
    const secondCookie = secondRegister.headers.get('set-cookie').split(';')[0]
    const crossUser = await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie: secondCookie } })
    assert.equal(crossUser.status, 404)
    const unauthorized = await fetch(`${base}/api/projects/${project.id}`)
    assert.equal(unauthorized.status, 401)
    const remove = await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE', headers: { cookie } })
    assert.equal(remove.status, 200)
    assert.equal((await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects.length, 0)
    const savedText = await readFile(join(dir, 'stars.json'), 'utf8')
    assert.match(savedText, /test@example.com/)
    const saved = JSON.parse(savedText)
    assert.equal(saved.sessions[0].token.length, 64)
    assert.notEqual(saved.sessions[0].token, cookie.split('=')[1])
  } finally { child.kill() }
})

test('concurrent registrations for one email create one account and return one conflict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-register-race-'))
  const port = 19000 + Math.floor(Math.random() * 100)
  const dataFile = join(dir, 'stars.json')
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), STARS_STORAGE: 'json', STARS_DATA_FILE: dataFile } })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, child)
    const register = () => fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'race@example.test', password: 'password123' }) })
    const responses = await Promise.all([register(), register()])
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 400])
    const conflict = responses.find(response => response.status === 400)
    assert.equal((await conflict.json()).error.code, 'REGISTRATION_ERROR')
    const saved = JSON.parse(await readFile(dataFile, 'utf8'))
    assert.equal(saved.users.filter(user => user.email === 'race@example.test').length, 1)
    assert.equal(saved.sessions.length, 1)
  } finally { child.kill() }
})

test('API refuses generation without an explicitly enabled development Stub', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-no-model-'))
  const port = 19100 + Math.floor(Math.random() * 100)
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ALLOW_STUB_MODEL: 'false', STARS_STORAGE: 'json', STARS_DATA_FILE: join(dir, 'stars.json') } })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, child)
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'no-model@example.test', password: 'password123' }) })
    const cookie = register.headers.get('set-cookie').split(';')[0]
    const create = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'No model' }) })
    const project = (await create.json()).project
    const run = await fetch(`${base}/api/projects/${project.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ prompt: 'Build a page' }) })
    assert.equal(run.status, 503)
    assert.equal((await run.json()).error.code, 'MODEL_NOT_CONFIGURED')
  } finally { child.kill() }
})

test('OpenAI-compatible model output is validated before project files are replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-model-'))
  const port = 19200 + Math.floor(Math.random() * 100)
  const validFiles = [
    { path: 'index.html', content: '<!doctype html><html><body><h1>Generated Stars app</h1></body></html>' },
    { path: 'style.css', content: 'body{font-family:system-ui}' },
  ]
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(req.headers.authorization, 'Bearer mock-secret')
    const prompt = JSON.parse(request.messages[1].content).request
    const outputs = {
      success: { files: validFiles },
      path: { files: [{ path: '../escape.html', content: 'bad' }, ...validFiles] },
      external: { files: [{ path: 'index.html', content: '<img src="https://evil.example/a.png">' }] },
      entity: { files: [{ path: 'index.html', content: '<img src="https&colon;&sol;&sol;evil.example/a.png">' }] },
      ip: { files: [{ path: 'index.html', content: '<img src="//192.168.1.1:8080/a.png">' }] },
      ipv6: { files: [{ path: 'index.html', content: '<a href="//[::1]/">bad</a>' }] },
      encoded: { files: [{ path: 'index.html', content: '<img src="&amp;#47;&amp;#47;127.0.0.1/a.png">' }] },
      backslash: { files: [{ path: 'index.html', content: '<a href="https:/\\evil.example">bad</a>' }] },
      controls: { files: [{ path: 'index.html', content: '<a href="h\tttps://evil.example">bad</a>' }] },
      scheme: { files: [{ path: 'index.html', content: '<a href="https:evil.example">bad</a>' }] },
      brand: { files: [{ path: 'index.html', content: '<title>Atoms</title>' }] },
      duplicate: { files: [{ path: 'index.html', content: '<h1>one</h1>' }, { path: 'index.html', content: '<h1>two</h1>' }] },
      oversized: { files: [{ path: 'index.html', content: 'x'.repeat(256 * 1024 + 1) }] },
      total: { files: [{ path: 'index.html', content: 'x' }, ...Array.from({ length: 5 }, (_, index) => ({ path: `chunk${index}.js`, content: 'x'.repeat(220 * 1024) }))] },
      count: { files: [{ path: 'index.html', content: 'x' }, ...Array.from({ length: 50 }, (_, index) => ({ path: `file${index}.js`, content: 'x' }))] },
    }
    if (prompt === 'provider-error') { res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'private provider detail' })) }
    if (prompt === 'timeout') { await wait(1300); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}') }
    if (prompt === 'invalid-json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{invalid') }
    const output = outputs[prompt]
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const providerPort = provider.address().port
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ALLOW_STUB_MODEL: 'false', STARS_STORAGE: 'json', MODEL_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, MODEL_API_KEY: 'mock-secret', MODEL_NAME: 'mock-model', MODEL_TIMEOUT_MS: '1000', STARS_DATA_FILE: join(dir, 'stars.json') } })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, child)
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'model@example.test', password: 'password123' }) })
    const cookie = register.headers.get('set-cookie').split(';')[0]
    const create = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Model test' }) })
    const project = (await create.json()).project
    const runPrompt = async prompt => {
      const planId = await planRun(base, project.id, cookie, prompt)
      const response = await fetch(`${base}/api/projects/${project.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ planId, idempotencyKey: planId }) })
      assert.equal(response.status, 200)
      return { events: await response.text(), planId }
    }

    const { events: success, planId } = await runPrompt('success')
    assert.match(success, /event: review/)
    assert.doesNotMatch(success, /event: done|event: error/)
    const unapproved = await (await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie } })).json()
    assert.equal(unapproved.files.length, 0)
    assert.equal((await fetch(`${base}/api/projects/${project.id}/runs/${planId}/approve`, { method: 'POST', headers: { cookie } })).status, 200)
    const initialFiles = (await (await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie } })).json()).files
    assert.deepEqual(initialFiles.map(file => file.path).sort(), ['index.html', 'style.css'])
    assert.match(initialFiles.find(file => file.path === 'index.html').content, /Generated Stars app/)

    const cases = [['path', 'MODEL_INVALID_OUTPUT'], ['duplicate', 'MODEL_INVALID_OUTPUT'], ['count', 'MODEL_INVALID_OUTPUT'], ['invalid-json', 'MODEL_PROVIDER_ERROR'], ['provider-error', 'MODEL_PROVIDER_ERROR'], ['timeout', 'MODEL_TIMEOUT'], ['external', 'UNSAFE_GENERATED_CONTENT'], ['entity', 'UNSAFE_GENERATED_CONTENT'], ['ip', 'UNSAFE_GENERATED_CONTENT'], ['ipv6', 'UNSAFE_GENERATED_CONTENT'], ['encoded', 'UNSAFE_GENERATED_CONTENT'], ['backslash', 'UNSAFE_GENERATED_CONTENT'], ['controls', 'UNSAFE_GENERATED_CONTENT'], ['scheme', 'UNSAFE_GENERATED_CONTENT'], ['brand', 'UNSAFE_GENERATED_CONTENT'], ['oversized', 'MODEL_OUTPUT_TOO_LARGE'], ['total', 'MODEL_OUTPUT_TOO_LARGE']]
    for (const [prompt, errorCode] of cases) {
      const { events: failed } = await runPrompt(prompt)
      assert.match(failed, /event: error/)
      assert.match(failed, new RegExp(`"errorCode":"${errorCode}"`))
      assert.doesNotMatch(failed, /private provider detail|mock-secret/)
      assert.doesNotMatch(failed, /event: done/)
      const projectState = await (await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie } })).json()
      assert.deepEqual(projectState.files.map(file => [file.path, file.content]).sort(), initialFiles.map(file => [file.path, file.content]).sort())
    }
    const db = JSON.parse(await readFile(join(dir, 'stars.json'), 'utf8'))
    assert.equal(db.runs.filter(run => run.status === 'done').length, 1)
    assert.deepEqual(db.runs.filter(run => run.status === 'failed').map(run => run.errorCode).sort(), cases.map(([, code]) => code).sort())
  } finally {
    child.kill()
    await new Promise(resolve => provider.close(resolve))
  }
})
